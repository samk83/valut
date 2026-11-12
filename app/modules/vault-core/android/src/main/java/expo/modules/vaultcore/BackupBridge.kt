package expo.modules.vaultcore

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import com.jellydock.privatevault.core.BackupFolder
import com.jellydock.privatevault.core.BackupKeyMismatchException
import com.jellydock.privatevault.core.NoRecoveryKeyException
import com.jellydock.privatevault.core.NotABackupException
import com.jellydock.privatevault.core.RecoveryKey
import com.jellydock.privatevault.core.Vault
import com.jellydock.privatevault.core.VaultStateException
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import java.io.OutputStream

/**
 * Encrypted backup into a folder the user picked with the system folder picker (Storage
 * Access Framework). Backups and restores run on their own thread, because they can take
 * minutes, and report to JS through [emit]:
 *   { phase: "backup-done" | "backup-error" | "restore-progress" | "restore-done" | "restore-error", ... }
 */
internal class BackupBridge(
  private val context: () -> Context,
  private val vault: () -> Vault,
  private val stateDir: () -> File,
  private val emit: (Map<String, Any?>) -> Unit,
) {
  private val lock = Any()
  private var running: Thread? = null
  private var backingUp = false
  private var again = false

  private val stateFile get() = File(stateDir(), "backup-state.json")

  fun status(): Map<String, Any?> {
    val state = readState()
    return mapOf(
      "hasRecoveryKey" to vault().hasRecoveryKey(),
      "keyConfirmed" to vault().isRecoveryKeyConfirmed(),
      "restorePending" to state.optBoolean("restorePending", false),
      "folderName" to state.optString("folderName").ifEmpty { null },
      "lastBackupAt" to state.optDouble("lastBackupAt", 0.0),
      "lastError" to state.optString("lastError").ifEmpty { null },
      "running" to synchronized(lock) { running?.isAlive == true },
    )
  }

  /** Remembers the picked folder (a backup subfolder is created inside). */
  fun setFolder(treeUri: String): Map<String, Any?> {
    val tree = Uri.parse(treeUri)
    return try {
      val folder = SafBackupFolder.open(context().contentResolver, tree, create = true)
      // A folder with another vault's backup must not be mixed with this one.
      if (vault().isUnlocked && vault().hasRecoveryKey()) {
        val rk = vault().recoveryKey()
        if (rk != null) {
          try {
            if (BACKUP_INFO in folder.list()) Vault.checkBackup(folder, rk)
          } finally {
            rk.fill(0)
          }
        }
      }
      writeState { it.put("treeUri", treeUri).put("folderName", folder.displayName).put("lastError", "") }
      mapOf("ok" to true, "folderName" to folder.displayName)
    } catch (e: BackupKeyMismatchException) {
      mapOf("ok" to false, "error" to "FOREIGN")
    } catch (e: SecurityException) {
      mapOf("ok" to false, "error" to "NO_ACCESS")
    } catch (e: Exception) {
      mapOf("ok" to false, "error" to "FAILED")
    }
  }

  /** Forgets the backup folder and status (the vault was destroyed or a new one made). */
  fun reset() {
    synchronized(this) { stateFile.delete() }
  }

  /** The user chose not to continue an unfinished restore. */
  fun dismissRestore() = writeState { it.put("restorePending", false) }

  /** Records that the user checked their copy of the recovery key. */
  fun confirmKey() = vault().confirmRecoveryKey()

  /**
   * Starts a backup in the background. If one is already running it runs once more after it,
   * so items added meanwhile are copied too.
   */
  fun backupNow(): Boolean {
    synchronized(lock) {
      if (running?.isAlive == true) {
        if (backingUp) again = true
        return backingUp
      }
      val treeUri = readState().optString("treeUri").ifEmpty { null } ?: return false
      if (!vault().hasRecoveryKey() || !vault().isUnlocked) return false
      backingUp = true
      running =
        Thread({
          try {
            do {
              emit(runBackup(treeUri))
            } while (takeAgain())
          } catch (e: Throwable) {
            synchronized(lock) {
              backingUp = false
              running = null
            }
            throw e
          }
        }, "vault-backup").also { it.start() }
      return true
    }
  }

  // Ends the run in the same locked step that finds no new request, so a request arriving
  // at that moment starts a fresh run instead of being lost.
  private fun takeAgain(): Boolean =
    synchronized(lock) {
      val more = again
      again = false
      if (!more) {
        backingUp = false
        running = null
      }
      more
    }

  private fun runBackup(treeUri: String): Map<String, Any?> =
    try {
      val folder = SafBackupFolder.open(context().contentResolver, Uri.parse(treeUri), create = true)
      val report = vault().backupTo(folder)
      writeState { it.put("lastBackupAt", System.currentTimeMillis().toDouble()).put("lastError", "") }
      mapOf("phase" to "backup-done", "written" to report.written, "removed" to report.removed, "total" to report.total)
    } catch (e: VaultStateException) {
      // Locked while running: nothing is wrong, the next run continues.
      mapOf("phase" to "backup-error", "error" to "LOCKED")
    } catch (e: Exception) {
      // In a backup, a key mismatch means the folder holds another vault's backup.
      val code = if (e is BackupKeyMismatchException) "FOREIGN" else errorCode(e)
      writeState { it.put("lastError", code) }
      mapOf("phase" to "backup-error", "error" to code)
    }

  /** Checks that [treeUri] holds a backup the typed key opens. Returns its item count. */
  fun check(
    treeUri: String,
    keyText: String,
  ): Map<String, Any?> {
    val rk = runCatching { RecoveryKey.parse(keyText) }.getOrNull() ?: return mapOf("ok" to false, "error" to "BAD_KEY")
    return try {
      val folder = SafBackupFolder.open(context().contentResolver, Uri.parse(treeUri), create = false)
      Vault.checkBackup(folder, rk)
      mapOf("ok" to true, "count" to Vault.backupItemCount(folder))
    } catch (e: Exception) {
      mapOf("ok" to false, "error" to errorCode(e))
    } finally {
      rk.fill(0)
    }
  }

  /** Restores in the background; progress and the result arrive as events. */
  fun restore(
    treeUri: String,
    keyText: String,
  ): Boolean {
    val rk = runCatching { RecoveryKey.parse(keyText) }.getOrNull() ?: return false
    synchronized(lock) {
      if (running?.isAlive == true) return false
      // Remembered until it finishes, so an interrupted restore can be offered again.
      writeState { it.put("restorePending", true) }
      running =
        Thread({
          val result =
            try {
              val folder = SafBackupFolder.open(context().contentResolver, Uri.parse(treeUri), create = false)
              val report =
                vault().restoreFrom(folder, rk) { done, total ->
                  emit(mapOf("phase" to "restore-progress", "done" to done, "total" to total))
                }
              // Later backups continue into the folder the photos came from.
              if (readState().optString("treeUri").isEmpty()) {
                writeState { it.put("treeUri", treeUri).put("folderName", folder.displayName) }
              }
              writeState { it.put("restorePending", false) }
              mapOf("phase" to "restore-done", "restored" to report.restored, "alreadyHere" to report.alreadyHere, "damaged" to report.damaged)
            } catch (e: Exception) {
              mapOf("phase" to "restore-error", "error" to errorCode(e))
            } finally {
              rk.fill(0)
            }
          emit(result)
        }, "vault-restore").also { it.start() }
      return true
    }
  }

  private fun errorCode(e: Exception) =
    when (e) {
      is NotABackupException, is FileNotFoundException -> "NOT_A_BACKUP"
      is BackupKeyMismatchException -> "WRONG_KEY"
      is NoRecoveryKeyException -> "NO_KEY"
      is VaultStateException -> "LOCKED"
      is SecurityException -> "NO_ACCESS"
      else -> if (e.message?.contains("ENOSPC") == true || e.message?.contains("No space") == true) "FULL" else "FAILED"
    }

  @Synchronized
  private fun readState(): JSONObject = runCatching { JSONObject(stateFile.readText()) }.getOrElse { JSONObject() }

  @Synchronized
  private fun writeState(change: (JSONObject) -> Unit) {
    val state = readState()
    change(state)
    stateFile.parentFile?.mkdirs()
    val tmp = File(stateFile.path + ".tmp")
    tmp.writeText(state.toString())
    tmp.renameTo(stateFile)
  }

  private companion object {
    const val BACKUP_INFO = "backup.pvbi"
  }
}

/**
 * [BackupFolder] on a Storage Access Framework folder (any folder the user picked: phone
 * storage, SD card, Google Drive). Files are written under a temporary name and renamed.
 */
internal class SafBackupFolder private constructor(
  private val resolver: ContentResolver,
  private val tree: Uri,
  private val dirId: String,
  val displayName: String,
) : BackupFolder {
  // Sizes from the last [list], so checking every copy needs no extra queries.
  private var sizes: Map<String, Long> = emptyMap()

  override fun list(): List<String> {
    val all = childrenWithSize(resolver, tree, dirId)
    sizes = all.associate { it.second to it.third }
    return all.map { it.second }
  }

  override fun size(name: String): Long = sizes[name] ?: -1

  override fun openRead(name: String): InputStream {
    val id = find(name) ?: throw FileNotFoundException(name)
    return resolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id)) ?: throw FileNotFoundException(name)
  }

  override fun write(
    name: String,
    block: (OutputStream) -> Unit,
  ) {
    val partName = name + PART
    find(partName)?.let { deleteById(it) }
    val part =
      DocumentsContract.createDocument(resolver, dirUri(), OCTET, partName)
        ?: throw FileNotFoundException("Cannot create $partName")
    try {
      resolver.openOutputStream(part, "w")?.use { out ->
        block(out)
        out.flush()
      } ?: throw FileNotFoundException("Cannot write $partName")
      find(name)?.let { deleteById(it) }
      val renamed = runCatching { DocumentsContract.renameDocument(resolver, part, name) }.getOrNull()
      if (renamed == null) {
        // Some providers cannot rename: copy the finished part to the final name instead.
        // A copy that fails is removed, so a half file never counts as backed up.
        val target = DocumentsContract.createDocument(resolver, dirUri(), OCTET, name) ?: throw FileNotFoundException(name)
        try {
          val input = resolver.openInputStream(part) ?: throw FileNotFoundException(partName)
          input.use { i ->
            val out = resolver.openOutputStream(target, "w") ?: throw FileNotFoundException(name)
            out.use { i.copyTo(it) }
          }
        } catch (e: Exception) {
          runCatching { DocumentsContract.deleteDocument(resolver, target) }
          throw e
        }
        DocumentsContract.deleteDocument(resolver, part)
      }
    } catch (e: Exception) {
      runCatching { DocumentsContract.deleteDocument(resolver, part) }
      throw e
    }
  }

  override fun delete(name: String) {
    find(name)?.let { deleteById(it) }
  }

  private fun deleteById(id: String) {
    if (!DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, id))) {
      throw java.io.IOException("Could not delete a backup file")
    }
  }

  private fun dirUri() = DocumentsContract.buildDocumentUriUsingTree(tree, dirId)

  private fun find(name: String) = children().firstOrNull { it.second == name }?.first

  private fun children(): List<Pair<String, String>> = childrenOf(resolver, tree, dirId)

  companion object {
    const val SUBFOLDER = "Private Vision Vault Backup"
    private const val PART = ".part"
    private const val OCTET = "application/octet-stream"

    /**
     * The backup folder for a picked folder: the folder itself if it already holds a backup
     * (the user picked the backup folder), otherwise its [SUBFOLDER], created if [create].
     */
    fun open(
      resolver: ContentResolver,
      tree: Uri,
      create: Boolean,
    ): SafBackupFolder {
      val rootId = DocumentsContract.getTreeDocumentId(tree)
      val rootChildren = childrenOf(resolver, tree, rootId)
      if (rootChildren.any { it.second == "backup.pvbi" }) {
        return SafBackupFolder(resolver, tree, rootId, nameOf(resolver, tree, rootId) ?: SUBFOLDER)
      }
      val sub = rootChildren.firstOrNull { it.second == SUBFOLDER }?.first
      if (sub != null) return SafBackupFolder(resolver, tree, sub, SUBFOLDER)
      if (!create) throw NotABackupException()
      val made =
        DocumentsContract.createDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, rootId), Document.MIME_TYPE_DIR, SUBFOLDER)
          ?: throw FileNotFoundException("Cannot create the backup folder")
      return SafBackupFolder(resolver, tree, DocumentsContract.getDocumentId(made), SUBFOLDER)
    }

    private fun childrenOf(
      resolver: ContentResolver,
      tree: Uri,
      parentId: String,
    ): List<Pair<String, String>> {
      val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
      val out = mutableListOf<Pair<String, String>>()
      resolver.query(uri, arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
        while (c.moveToNext()) out += c.getString(0) to c.getString(1)
      }
      return out
    }

    private fun childrenWithSize(
      resolver: ContentResolver,
      tree: Uri,
      parentId: String,
    ): List<Triple<String, String, Long>> {
      val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
      val out = mutableListOf<Triple<String, String, Long>>()
      resolver.query(uri, arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_SIZE), null, null, null)?.use { c ->
        while (c.moveToNext()) out += Triple(c.getString(0), c.getString(1), if (c.isNull(2)) -1L else c.getLong(2))
      }
      return out
    }

    private fun nameOf(
      resolver: ContentResolver,
      tree: Uri,
      id: String,
    ): String? =
      resolver.query(DocumentsContract.buildDocumentUriUsingTree(tree, id), arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
  }
}
