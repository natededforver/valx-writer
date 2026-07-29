# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# The JS bridges in MainActivity (window insets, print, share).
#
# Release builds run R8 with minification on. A method reached only from
# JavaScript by name has no Kotlin caller for R8 to see, so without this it
# shrinks away or gets renamed — and the failure appears only in a release APK,
# as a phone whose chrome sits under the status bar and whose Print and Share
# do nothing. The debug build, which does not minify, looks perfect throughout.
#
# Matched by annotation rather than by class name so a bridge added later is
# covered without anyone having to remember this file.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
