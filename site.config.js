/*
 * Public-site configuration. The ONLY place the application entry point is set.
 *
 * appUrl        Where "Sign in" / "Open MeritNama" send people. Today this is the
 *               legacy in-repo app (app.html). When the private meritNAMA-app is
 *               deployed, set it to that origin, e.g. "https://app.example.org/".
 * appHealthUrl  Optional. Public, unauthenticated health endpoint of the private
 *               app (GET, returns {"status":"ok"}). When set and unreachable, the
 *               landing page shows an availability notice instead of an error.
 *               Leave empty while appUrl points at the static legacy app.
 * legacySessionRedirect
 *               Keep the old behaviour of sending a signed-in legacy user
 *               (localStorage session) straight to appUrl. Turn off once the
 *               private app owns authentication.
 * homepageContentUrl
 *               Read-only Firestore REST document with admin-edited hero subhead and
 *               snapshot figures (edited in admin.html → Homepage). Empty disables.
 *
 * Never put secrets, API keys or internal hostnames in this file — it is public.
 */
window.MERITNAMA_CONFIG = {
  appUrl: "app.html",
  appHealthUrl: "",
  legacySessionRedirect: true,
  homepageContentUrl:
    "https://firestore.googleapis.com/v1/projects/mortality-review/databases/(default)/documents/notifications/homepage_content",
  contactEmail: "itskaero@gmail.com"
};
