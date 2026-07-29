package com.valx.prose_writer

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

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

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // The adapter that PrintManager drives reads back through this WebView while
  // the job renders, so it has to outlive print(). One slot, overwritten by the
  // next print — a job still rendering when a second one starts is not a case
  // worth a queue.
  private var printView: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
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
