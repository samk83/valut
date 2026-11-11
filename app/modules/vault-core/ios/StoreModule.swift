import ExpoModulesCore
import StoreKit

/// 1.1 Premium (one-time, lifetime, unlimited storage) through StoreKit 2 directly, with no
/// third-party SDK and no server: Apple keeps the purchase and signs it, so nothing about
/// the user is collected by the app. Same JS API as android/.../StoreModule.kt:
///   status()   -> { available, premium, pending, price }
///   purchase() -> "purchased" | "pending" | "cancelled" | "unavailable" | "error"
///   restore()  -> premium (Bool)
///   event "onPremiumChanged" { premium }
/// Family Sharing is switched on for the product in App Store Connect.
public final class StoreModule: Module {
  static let productId = "com.jellydock.privatevault.premium"
  private var updates: Task<Void, Never>?
  private var lastPremium: Bool?

  public func definition() -> ModuleDefinition {
    Name("VaultStore")

    Events("onPremiumChanged")

    OnCreate {
      // Purchases finished outside the app (Ask to Buy approved, a family member, a refund).
      self.updates = Task.detached { [weak self] in
        for await update in Transaction.updates {
          if case .verified(let transaction) = update { await transaction.finish() }
          await self?.publish()
        }
      }
    }

    OnDestroy {
      self.updates?.cancel()
    }

    AsyncFunction("status") { () async -> [String: Any] in
      let product = try? await Product.products(for: [Self.productId]).first
      let premium = await Self.isPremium()
      self.remember(premium)
      return ["available": product != nil, "premium": premium, "pending": false, "price": product?.displayPrice ?? NSNull()]
    }

    AsyncFunction("purchase") { () async -> String in
      guard let product = try? await Product.products(for: [Self.productId]).first else { return "unavailable" }
      do {
        switch try await product.purchase() {
        case .success(let verification):
          guard case .verified(let transaction) = verification else { return "error" }
          await transaction.finish()
          await self.publish()
          return "purchased"
        case .pending:
          return "pending"
        case .userCancelled:
          return "cancelled"
        @unknown default:
          return "error"
        }
      } catch {
        return "error"
      }
    }

    AsyncFunction("restore") { () async -> Bool in
      // Asks the App Store to re-send this Apple ID's purchases (may show a sign-in sheet).
      try? await AppStore.sync()
      await self.publish()
      return await Self.isPremium()
    }
  }

  /// True when this Apple ID (or its Family Sharing group) owns Premium and it was not refunded.
  static func isPremium() async -> Bool {
    for await result in Transaction.currentEntitlements {
      if case .verified(let t) = result, t.productID == productId, t.revocationDate == nil { return true }
    }
    return false
  }

  private func publish() async {
    let premium = await Self.isPremium()
    if remember(premium) { sendEvent("onPremiumChanged", ["premium": premium]) }
  }

  /// Returns true when the value changed.
  @discardableResult
  private func remember(_ premium: Bool) -> Bool {
    objc_sync_enter(self)
    defer { objc_sync_exit(self) }
    let changed = lastPremium != premium
    lastPremium = premium
    return changed
  }
}
