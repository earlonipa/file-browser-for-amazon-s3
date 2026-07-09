// Shared authentication helpers for the file manager's login-gated upload feature.
// Used by both login.html (to sign in) and main.js (to check session state, refresh tokens,
// and mint temporary AWS credentials permitted to write to the files bucket).
//
// Session model: Cognito issues short-lived ID/Access tokens (a few hours, per the App Client's
// TokenValidityUnits) plus a refresh token. On top of that, this file enforces its own hard cap
// (AUTH_SESSION_MAX_MS) so a signed-in tab never stays authenticated indefinitely just because the
// refresh token happens to still be valid - once the cap is hit, the person has to sign in again.

const AUTH_SESSION_STORAGE_KEY = 'pfb_auth_session'
const AUTH_SESSION_MAX_MS = 4 * 60 * 60 * 1000 // "a few hours"
const AUTH_REFRESH_SKEW_MS = 60 * 1000 // refresh slightly before the token actually expires

function authGetUserPoolProviderName() {
    // e.g. "cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_AbCdEfGhI"
    const region = awsConfigOptions.identity_pool_id.split(':')[0]
    return 'cognito-idp.' + region + '.amazonaws.com/' + awsConfigOptions.user_pool_id
}

function authGetCognitoIdpClient() {
    return new AWS.CognitoIdentityServiceProvider({
        region: awsConfigOptions.identity_pool_id.split(':')[0]
    })
}

function authReadSession() {
    try {
        const raw = window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)
        if (!raw) { return null }
        return JSON.parse(raw)
    } catch (e) {
        return null
    }
}

function authWriteSession(session) {
    try {
        window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session))
    } catch (e) {
        // If sessionStorage is unavailable (e.g. privacy mode), the session simply won't persist
        // across a reload - the person will just be asked to sign in again, not a hard failure.
    }
}

function authClearSession() {
    try {
        window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY)
    } catch (e) {
        // Ignore.
    }
}

// Called by login.html after a successful InitiateAuth (USER_PASSWORD_AUTH) call.
function authStoreNewSession(authenticationResult, username) {
    const now = Date.now()
    authWriteSession({
        username: username,
        idToken: authenticationResult.IdToken,
        accessToken: authenticationResult.AccessToken,
        refreshToken: authenticationResult.RefreshToken,
        tokenExpiresAt: now + (authenticationResult.ExpiresIn * 1000),
        sessionStartedAt: now
    })
}

// Returns true if there is a currently-usable session (may still need a token refresh - use
// authGetValidIdToken() for anything that actually needs to call AWS).
function authIsLoggedIn() {
    const session = authReadSession()
    if (!session) { return false }
    if (Date.now() - session.sessionStartedAt > AUTH_SESSION_MAX_MS) {
        authClearSession()
        return false
    }
    return true
}

// Ensures the stored ID token is still valid (refreshing it via the refresh token if it's about
// to expire), and returns it. Returns null if there's no session, the overall session cap has
// been hit, or the refresh attempt fails (e.g. refresh token itself expired/revoked) - in all of
// those cases the caller should treat the person as signed out.
function authGetValidIdToken() {
    return new Promise(function(resolve) {
        const session = authReadSession()
        if (!session) { resolve(null); return }
        if (Date.now() - session.sessionStartedAt > AUTH_SESSION_MAX_MS) {
            authClearSession()
            resolve(null)
            return
        }
        if (Date.now() < session.tokenExpiresAt - AUTH_REFRESH_SKEW_MS) {
            resolve(session.idToken)
            return
        }
        // Token is expired or about to be - silently refresh using the refresh token.
        const cognitoIdp = authGetCognitoIdpClient()
        cognitoIdp.initiateAuth({
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: awsConfigOptions.user_pool_client_id,
            AuthParameters: {
                REFRESH_TOKEN: session.refreshToken
            }
        }, function(err, data) {
            if (err || !data || !data.AuthenticationResult) {
                authClearSession()
                resolve(null)
                return
            }
            const result = data.AuthenticationResult
            session.idToken = result.IdToken
            session.accessToken = result.AccessToken
            session.tokenExpiresAt = Date.now() + (result.ExpiresIn * 1000)
            // Note: refresh tokens are not rotated by this flow, session.refreshToken stays as-is.
            authWriteSession(session)
            resolve(session.idToken)
        })
    })
}

// Returns a Promise resolving to an AWS.Credentials object permitted to write to the files
// bucket (the CognitoIdentityAuthenticatedRole from the SAM template), or null if not signed in.
function authGetAwsCredentials() {
    return authGetValidIdToken().then(function(idToken) {
        if (!idToken) { return null }
        const logins = {}
        logins[authGetUserPoolProviderName()] = idToken
        const credentials = new AWS.CognitoIdentityCredentials({
            IdentityPoolId: awsConfigOptions.identity_pool_id,
            Logins: logins
        })
        return new Promise(function(resolve, reject) {
            credentials.get(function(err) {
                if (err) { reject(err); return }
                resolve(credentials)
            })
        })
    })
}

function authLogout(redirectTo) {
    authClearSession()
    window.location.href = redirectTo || '/login.html'
}
