package com.valx.prose_writer

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

/**
 * Edge-to-edge, plus a bridge that hands the real window insets to CSS.
 *
 * The app runs full-bleed so the note background reaches behind the status and
 * navigation bars instead of leaving two slabs the in-app dark mode can't
 * reach. It then has to inset its own chrome, and CSS alone cannot do it:
 * Android's WebView reports env(safe-area-inset-top) (the status bar, measured
 * at 50px on a Pixel 5) but reports env(safe-area-inset-bottom) as 0 even with
 * the gesture pill sitting on top of the footer. Only the Android side knows
 * the navigation-bar and IME insets, so it publishes all four and
 * lib/insets.ts turns them into the --vx-inset-* custom properties .vx-safe
 * reads.
 *
 * Pull, not push: the inset listener fires during layout, which on a cold
 * start is before the page exists, so an evaluateJavascript() there would land
 * on an empty document and be lost — on a slow phone, permanently. The page
 * asks for the values once it is ready instead, and this side only fires an
 * event to say "ask again" when they change (keyboard, rotation, a switch
 * between gesture and button navigation).
 */
class MainActivity : TauriActivity() {
  // CSS pixels — top, bottom, left, right. Written from the UI thread, read
  // from the WebView's JS thread.
  @Volatile private var insets = intArrayOf(0, 0, 0, 0)

  // The folder picker. Registered in the field initialiser because
  // registerForActivityResult must be called before the activity is STARTED —
  // doing it lazily from the bridge (which runs long after) throws.
  private val pickFolder =
    registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
      // Cancel comes back as null and is reported as such, so the web side can
      // keep the workspace it already had instead of waiting forever.
      announce("valx-folder-picked", uri?.let { treeUriToPath(it) })
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    hideSystemBars()
  }

  /**
   * Hide status bar and navigation bar for full-screen writing immersion.
   *
   * Uses WindowInsetsController on API 30+ with a deprecated-flag fallback for
   * 24–29 (the app's minSdk). BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE lets the
   * user peek the bars with an edge swipe — they slide back out after a moment.
   */
  private fun hideSystemBars() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.let {
        it.hide(
          android.view.WindowInsets.Type.statusBars()
            or android.view.WindowInsets.Type.navigationBars()
        )
        it.systemBarsBehavior =
          android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = (
        android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
          or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
          or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
          or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
          or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
          or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
      )
    }
  }

  /** Android resets immersive mode after dialogs and focus changes. */
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  /**
   * A SAF tree URI as a real filesystem path.
   *
   * The app's directory scanning is std::fs in Rust (read_directory), which
   * takes paths, not content:// URIs — so a picked folder is only usable once
   * it has been turned back into one. The document id of a tree URI is
   * "<volume>:<relative/path>", and for the primary volume that maps onto
   * getExternalStorageDirectory(); removable volumes live under /storage/<id>.
   *
   * This is the reason the app asks for All files access at all. Reading those
   * paths directly is exactly what scoped storage withholds, and the
   * alternative — reimplementing the whole workspace layer against
   * DocumentsContract — is a different app, not a different function.
   *
   * Returns null for anything that isn't a plain volume-relative folder, so an
   * exotic provider degrades to "cancelled" rather than to a path that doesn't
   * exist.
   */
  private fun treeUriToPath(uri: Uri): String? {
    val docId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull() ?: return null
    val parts = docId.split(':')
    if (parts.size != 2 || parts[1].isEmpty()) return null
    val (volume, relative) = parts
    val root =
      if (volume.equals("primary", ignoreCase = true))
        Environment.getExternalStorageDirectory().absolutePath
      else "/storage/$volume"
    return "$root/$relative"
  }

  /** Fire a window event carrying a JSON payload at the page. */
  private fun announce(event: String, value: String?) {
    val detail = if (value == null) "null" else JSONObject.quote(value)
    val js = "window.dispatchEvent(new CustomEvent('$event',{detail:$detail}))"
    runOnUiThread { webViewForEvents?.evaluateJavascript(js, null) }
  }

  private var webViewForEvents: WebView? = null

  // The adapter that PrintManager drives reads back through this WebView while
  // the job renders, so it has to outlive print(). One slot, overwritten by the
  // next print — a job still rendering when a second one starts is not a case
  // worth a queue.
  private var printView: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    webViewForEvents = webView

    // Lock text size to 100 % regardless of the system "Font size" slider:
    // without this the WebView inherits the OS setting and inflates all text.
    webView.settings.textZoom = 100
    // Disable built-in pinch zoom so accidental two-finger touches during
    // editing cannot scale the page (viewport meta user-scalable=no handles
    // the web side; this covers the native side).
    webView.settings.setSupportZoom(false)
    webView.settings.builtInZoomControls = false

    webView.addJavascriptInterface(InsetBridge(), "__valxInsets")
    webView.addJavascriptInterface(AndroidBridge(), "__valxAndroid")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      // IME included so the writing surface lifts above the keyboard: the
      // window is edge-to-edge, which takes adjustResize out of play.
      val i = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.ime()
      )
      val density = view.resources.displayMetrics.density
      insets = intArrayOf(
        (i.top / density).toInt(),
        (i.bottom / density).toInt(),
        (i.left / density).toInt(),
        (i.right / density).toInt(),
      )
      webView.evaluateJavascript("window.dispatchEvent(new Event('valx-insets'))", null)
      windowInsets
    }
  }

  inner class InsetBridge {
    @JavascriptInterface
    fun get(): String = insets.joinToString(",")
  }

  /**
   * The two things the web layer cannot do for itself on Android.
   *
   * Both hop to the UI thread: @JavascriptInterface methods arrive on the
   * WebView's private JavaBridge thread, and neither PrintManager nor
   * startActivity may be touched from there.
   */
  inner class AndroidBridge {
    /**
     * Print a standalone HTML document.
     *
     * Android's WebView has no window.print() — the call is silently a no-op,
     * which is why Print did nothing on the phone. The platform prints through
     * PrintManager instead, and it needs a WebView to render from, so the
     * page's print HTML gets loaded into a throwaway one. That WebView never
     * attaches to the view tree; PrintDocumentAdapter only needs it laid out
     * internally.
     *
     * The document must be self-contained. This WebView is not wired to
     * Tauri's asset protocol, so an <img src="http://asset.localhost/…"> would
     * come out blank — lib/android.ts inlines every image as a data: URL
     * before calling here.
     */
    @JavascriptInterface
    fun print(html: String, jobName: String) {
      runOnUiThread {
        val web = WebView(this@MainActivity)
        web.webViewClient = object : WebViewClient() {
          override fun onPageFinished(view: WebView, url: String?) {
            val manager = getSystemService(Context.PRINT_SERVICE) as PrintManager
            manager.print(
              jobName,
              view.createPrintDocumentAdapter(jobName),
              PrintAttributes.Builder().build(),
            )
          }
        }
        printView = web
        web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
      }
    }

    /**
     * Whether the app may read and write folders outside its own storage.
     *
     * Android 11 replaced the old read/write permission with All files access,
     * which the user grants on a Settings screen rather than in a dialog — so
     * there is nothing to "request" in-process, only somewhere to send them.
     * Below 11 the ordinary runtime permission still applies.
     */
    @JavascriptInterface
    fun hasStorageAccess(): Boolean =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
      else ContextCompat.checkSelfPermission(
        this@MainActivity, android.Manifest.permission.WRITE_EXTERNAL_STORAGE
      ) == PackageManager.PERMISSION_GRANTED

    /** Send the user where the grant is made. Returns once the screen opens. */
    @JavascriptInterface
    fun requestStorageAccess() {
      runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          // The per-app screen, with a fallback to the app list: some OEM builds
          // (and some emulator images) don't implement the package-scoped one,
          // and an unhandled intent would crash rather than do nothing.
          val scoped = Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:$packageName"),
          )
          val target =
            if (scoped.resolveActivity(packageManager) != null) scoped
            else Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
          runCatching { startActivity(target) }
        } else {
          ActivityCompat.requestPermissions(
            this@MainActivity,
            arrayOf(
              android.Manifest.permission.READ_EXTERNAL_STORAGE,
              android.Manifest.permission.WRITE_EXTERNAL_STORAGE,
            ),
            /* requestCode = */ 4711,
          )
        }
      }
    }

    /**
     * Open the system folder picker. The chosen path arrives as a
     * 'valx-folder-picked' window event (null if cancelled) — a
     * @JavascriptInterface method returns synchronously and a picker does not,
     * so the answer cannot come back through the return value.
     */
    @JavascriptInterface
    fun pickFolder() {
      runOnUiThread { runCatching { pickFolder.launch(null) } }
    }

    /** Hand text to the system share sheet (ACTION_SEND chooser). */
    @JavascriptInterface
    fun share(text: String, subject: String) {
      runOnUiThread {
        val send = Intent(Intent.ACTION_SEND).apply {
          type = "text/plain"
          putExtra(Intent.EXTRA_TEXT, text)
          if (subject.isNotEmpty()) putExtra(Intent.EXTRA_SUBJECT, subject)
        }
        startActivity(Intent.createChooser(send, null))
      }
    }
  }
}
