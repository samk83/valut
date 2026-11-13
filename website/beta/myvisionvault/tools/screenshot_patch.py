"""Temporary, screenshot-only changes to the app's web preview. NEVER COMMIT the result.
Run in app/ before `npx expo export -p web`, then undo with `git checkout -- app`.
- The preview vault reports the Secure Enclave and a PIN lock (as on a real iPhone).
- Photo search works in the preview: notes come from window.__NOTES (set by capture_shots.js).
- The backup shows as set up (folder and last backup time); video tiles show /posters/<n>.jpg.
"""
import io
def sub(path, old, new, count=1):
    s=io.open(path,encoding='utf-8').read()
    assert old in s, (path, old[:60]); s=s.replace(old,new,count); io.open(path,'w',encoding='utf-8',newline='').write(s)
sub('modules/vault-core/src/DemoVault.ts', "hardware: 'Preview (no encryption)'", "hardware: 'SECURE_ENCLAVE'")
sub('src/pattern.tsx', "return v === 'pin' || v === 'pattern' ? v : null;\n  } catch {\n    return null;", "return v === 'pin' || v === 'pattern' ? v : 'pin';\n  } catch {\n    return 'pin';")
sub('src/pattern.tsx', "if (!f.exists) return null;", "if (!f.exists) return 'pin';")
V='modules/vault-core/src/VaultCoreModule.ts'
sub(V, "canRead: false as const,\n      analyze: async (_id: string): Promise<string | null> => null,",
 "canRead: true as const,\n      analyze: async (id: string): Promise<string | null> => { const l = (await DemoVault.list()).slice().reverse(); const i = l.findIndex((x) => x.id === id); await new Promise((r) => setTimeout(r, 120)); return ((globalThis as any).__NOTES || [])[i] ?? null; },")
sub(V, "hasRecoveryKey: false,\n        keyConfirmed: false,\n        restorePending: false,\n        folderName: null,\n        lastBackupAt: 0,",
 "hasRecoveryKey: true,\n        keyConfirmed: true,\n        restorePending: false,\n        folderName: 'iCloud Drive / Vault Backup',\n        lastBackupAt: Date.now() - 12 * 60_000,")
sub(V, "        return item?.kind === 'PHOTO' ? DemoVault.uriOf(id) : null;",
 "        if (item?.kind === 'VIDEO') { const v = (await DemoVault.list()).slice().reverse().filter((x) => x.kind === 'VIDEO'); return `/posters/${v.findIndex((x) => x.id === id)}.jpg`; }\n        return item?.kind === 'PHOTO' ? DemoVault.uriOf(id) : null;")
print('patched')
