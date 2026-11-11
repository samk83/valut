package expo.modules.vaultcore

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 1.1 Premium (one-time, lifetime, unlimited storage) through Google Play Billing directly,
 * with no third-party SDK and no server: Google Play itself keeps the purchase, so nothing
 * about the user is collected by the app. JS API (same as the iPhone StoreModule):
 *   status()   -> { available, premium, pending, price }
 *   purchase() -> "purchased" | "pending" | "cancelled" | "unavailable" | "error"
 *   restore()  -> premium (Boolean)
 *   event "onPremiumChanged" { premium }
 *
 * The last known answer is cached on the phone so Premium keeps working offline; it is
 * corrected the next time Google Play can be asked (a refund removes it again).
 */
class StoreModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw CodedException("E_NO_CONTEXT", "React context is gone", null)

  private var client: BillingClient? = null
  private var details: ProductDetails? = null
  private var purchasePromise: Promise? = null
  private val lock = Any()

  private val prefs get() = context.getSharedPreferences("store", Context.MODE_PRIVATE)

  private val purchasesListener =
    PurchasesUpdatedListener { result, purchases ->
      val promise = synchronized(lock) { purchasePromise.also { purchasePromise = null } }
      when (result.responseCode) {
        BillingClient.BillingResponseCode.OK -> {
          val outcome = handle(purchases.orEmpty())
          promise?.resolve(outcome)
        }
        BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
          setPremium(true)
          promise?.resolve("purchased")
        }
        BillingClient.BillingResponseCode.USER_CANCELED -> promise?.resolve("cancelled")
        else -> promise?.resolve("error")
      }
    }

  override fun definition() =
    ModuleDefinition {
      Name("VaultStore")

      Events("onPremiumChanged")

      OnDestroy { runCatching { client?.endConnection() } }

      AsyncFunction("status") { promise: Promise ->
        connect { ready ->
          if (!ready) {
            promise.resolve(statusMap(available = false, pending = false))
            return@connect
          }
          refresh { pending ->
            loadDetails { promise.resolve(statusMap(available = details != null, pending = pending)) }
          }
        }
      }

      AsyncFunction("purchase") { promise: Promise ->
        val activity = appContext.currentActivity
        if (activity == null) {
          promise.resolve("error")
          return@AsyncFunction
        }
        connect { ready ->
          if (!ready) {
            promise.resolve("unavailable")
            return@connect
          }
          loadDetails {
            val product = details
            if (product == null) {
              promise.resolve("unavailable")
              return@loadDetails
            }
            val params =
              BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product).apply {
                product.oneTimePurchaseOfferDetailsList?.firstOrNull()?.offerToken?.let { setOfferToken(it) }
              }.build()
            synchronized(lock) {
              purchasePromise?.resolve("cancelled")
              purchasePromise = promise
            }
            activity.runOnUiThread {
              val result = client?.launchBillingFlow(activity, BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(params)).build())
              if (result?.responseCode != BillingClient.BillingResponseCode.OK) {
                val waiting = synchronized(lock) { purchasePromise.also { if (it === promise) purchasePromise = null } }
                if (waiting === promise) {
                  promise.resolve(if (result?.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) "purchased" else "error")
                  if (result?.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) setPremium(true)
                }
              }
            }
          }
        }
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("restore") { promise: Promise ->
        connect { ready ->
          if (!ready) {
            promise.resolve(cachedPremium())
            return@connect
          }
          refresh { promise.resolve(cachedPremium()) }
        }
      }
    }

  private fun statusMap(
    available: Boolean,
    pending: Boolean,
  ) = mapOf(
    "available" to available,
    "premium" to cachedPremium(),
    "pending" to pending,
    "price" to details?.oneTimePurchaseOfferDetails?.formattedPrice,
  )

  private fun connect(onReady: (Boolean) -> Unit) {
    val c =
      synchronized(lock) {
        client ?: BillingClient.newBuilder(context)
          .setListener(purchasesListener)
          .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
          .enableAutoServiceReconnection()
          .build()
          .also { client = it }
      }
    if (c.isReady) {
      onReady(true)
      return
    }
    var answered = false
    c.startConnection(
      object : BillingClientStateListener {
        override fun onBillingSetupFinished(result: BillingResult) {
          if (answered) return
          answered = true
          onReady(result.responseCode == BillingClient.BillingResponseCode.OK)
        }

        override fun onBillingServiceDisconnected() {
          if (answered) return
          answered = true
          onReady(false)
        }
      },
    )
  }

  private fun loadDetails(done: () -> Unit) {
    if (details != null) {
      done()
      return
    }
    val c = client ?: return done()
    val params =
      QueryProductDetailsParams.newBuilder().setProductList(
        listOf(
          QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PRODUCT_ID)
            .setProductType(BillingClient.ProductType.INAPP)
            .build(),
        ),
      ).build()
    c.queryProductDetailsAsync(params) { result, list ->
      if (result.responseCode == BillingClient.BillingResponseCode.OK) {
        details = list.productDetailsList.firstOrNull { it.productId == PRODUCT_ID }
      }
      done()
    }
  }

  /** Asks Google Play what this account owns. [done] gets whether a purchase is pending. */
  private fun refresh(done: (Boolean) -> Unit) {
    val c = client ?: return done(false)
    c.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { result, purchases ->
      if (result.responseCode != BillingClient.BillingResponseCode.OK) {
        done(false) // Offline or Play busy: keep the cached answer.
        return@queryPurchasesAsync
      }
      val ours = purchases.filter { PRODUCT_ID in it.products }
      if (ours.none { it.purchaseState == Purchase.PurchaseState.PURCHASED }) setPremium(false)
      handle(ours)
      done(ours.any { it.purchaseState == Purchase.PurchaseState.PENDING })
    }
  }

  /** Grants Premium for completed purchases and acknowledges them (Play refunds unacknowledged ones). */
  private fun handle(purchases: List<Purchase>): String {
    val ours = purchases.filter { PRODUCT_ID in it.products }
    val bought = ours.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
    for (p in bought) {
      if (!p.isAcknowledged) acknowledge(p.purchaseToken, attempt = 0)
    }
    if (bought.isNotEmpty()) {
      setPremium(true)
      return "purchased"
    }
    return if (ours.any { it.purchaseState == Purchase.PurchaseState.PENDING }) "pending" else "error"
  }

  /** Google Play refunds a purchase not acknowledged within 3 days, so failures are retried. */
  private fun acknowledge(
    token: String,
    attempt: Int,
  ) {
    val c = client ?: return
    c.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build()) { result ->
      if (result.responseCode != BillingClient.BillingResponseCode.OK && attempt < 5) {
        Handler(Looper.getMainLooper()).postDelayed({ acknowledge(token, attempt + 1) }, 5_000L shl attempt)
      }
    }
  }

  private fun cachedPremium() = prefs.getBoolean(KEY, false)

  private fun setPremium(value: Boolean) {
    if (cachedPremium() == value) return
    prefs.edit().putBoolean(KEY, value).apply()
    sendEvent("onPremiumChanged", mapOf("premium" to value))
  }

  private companion object {
    /** Same product id in Google Play Console and App Store Connect. */
    const val PRODUCT_ID = "com.jellydock.privatevault.premium"
    const val KEY = "premium"
  }
}
