import AuthenticationServices
import Capacitor
import CryptoKit
import Security
import UIKit

@objc(MindRoomAuthPlugin)
public class MindRoomAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "MindRoomAuthPlugin"
    public let jsName = "MindRoomAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise)
    ]

    private var authSession: ASWebAuthenticationSession?
    private var appleSignInCall: CAPPluginCall?
    private var appleSignInNonce: String?

    @objc func authenticate(_ call: CAPPluginCall) {
        guard authSession == nil else {
            call.reject("An authentication session is already in progress", "AUTH_IN_PROGRESS")
            return
        }

        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            call.reject("Must provide an HTTP(S) authentication URL", "INVALID_URL")
            return
        }

        let callbackScheme = call.getString("callbackScheme")
        let ephemeral = call.getBool("ephemeral") ?? false

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackUrl, error in
                DispatchQueue.main.async {
                    defer {
                        self?.authSession = nil
                    }

                    if let callbackUrl = callbackUrl {
                        call.resolve(["url": callbackUrl.absoluteString])
                        return
                    }

                    if let authError = error as? ASWebAuthenticationSessionError,
                       authError.code == .canceledLogin {
                        call.reject("Authentication cancelled", "AUTH_CANCELLED", authError)
                        return
                    }

                    call.reject(error?.localizedDescription ?? "Authentication failed", "AUTH_FAILED", error)
                }
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = ephemeral
            self.authSession = session

            if !session.start() {
                self.authSession = nil
                call.reject("Unable to start authentication session", "AUTH_START_FAILED")
            }
        }
    }

    @objc func signInWithApple(_ call: CAPPluginCall) {
        // Developer ID profiles do not grant native Sign in with Apple.
        // Reuse browser SSO on Catalyst; the App Store iPad build stays native.
        #if targetEnvironment(macCatalyst)
        authenticate(call)
        #else
        guard appleSignInCall == nil else {
            call.reject("A Sign in with Apple request is already in progress", "APPLE_AUTH_IN_PROGRESS")
            return
        }

        let nonce = randomNonceString()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = sha256(nonce)

        appleSignInCall = call
        appleSignInNonce = nonce

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
        #endif
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        presentationAnchor()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        presentationAnchor()
    }

    private func presentationAnchor() -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }

        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }

        return window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = appleSignInCall else { return }

        defer {
            appleSignInCall = nil
            appleSignInNonce = nil
        }

        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            call.reject("Unexpected Sign in with Apple credential", "APPLE_AUTH_INVALID_CREDENTIAL")
            return
        }

        guard let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8) else {
            call.reject("Sign in with Apple did not return an identity token", "APPLE_AUTH_MISSING_ID_TOKEN")
            return
        }

        var result: [String: Any] = [
            "identityToken": identityToken,
            "user": credential.user
        ]

        if let authorizationCodeData = credential.authorizationCode,
           let authorizationCode = String(data: authorizationCodeData, encoding: .utf8) {
            result["authorizationCode"] = authorizationCode
        }

        if let nonce = appleSignInNonce {
            result["nonce"] = nonce
        }

        if let email = credential.email {
            result["email"] = email
        }

        if let givenName = credential.fullName?.givenName {
            result["givenName"] = givenName
        }

        if let familyName = credential.fullName?.familyName {
            result["familyName"] = familyName
        }

        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = appleSignInCall else { return }

        defer {
            appleSignInCall = nil
            appleSignInNonce = nil
        }

        if let authError = error as? ASAuthorizationError,
           authError.code == .canceled {
            call.reject("Sign in with Apple cancelled", "APPLE_AUTH_CANCELLED", authError)
            return
        }

        call.reject(error.localizedDescription, "APPLE_AUTH_FAILED", error)
    }

    private func randomNonceString(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length

        while remainingLength > 0 {
            var randomBytes = [UInt8](repeating: 0, count: 16)
            let status = randomBytes.withUnsafeMutableBytes { buffer in
                guard let baseAddress = buffer.baseAddress else {
                    return errSecParam
                }

                return SecRandomCopyBytes(kSecRandomDefault, buffer.count, baseAddress)
            }

            if status != errSecSuccess {
                return UUID().uuidString.replacingOccurrences(of: "-", with: "")
            }

            for randomByte in randomBytes where remainingLength > 0 {
                if Int(randomByte) < charset.count {
                    result.append(charset[Int(randomByte)])
                    remainingLength -= 1
                }
            }
        }

        return result
    }

    private func sha256(_ value: String) -> String {
        let inputData = Data(value.utf8)
        let hashedData = SHA256.hash(data: inputData)
        return hashedData.map { String(format: "%02x", $0) }.joined()
    }
}
