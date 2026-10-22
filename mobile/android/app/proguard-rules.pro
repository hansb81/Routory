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

# ---- Capacitor 브리지 (2026-10-19, minifyEnabled true로 바꾸며 추가 - build.gradle의 DEP-02 참고) ----
# WebView(JS) <-> 네이티브 사이의 호출은 리플렉션/애너테이션으로 플러그인 클래스·메서드를 찾는다 - R8이
# "안 쓰는 코드"로 보고 이름을 바꾸거나 지우면 브리지가 깨진다. Capacitor 공식 문서가 권장하는 규칙이다.
# (각 Capacitor 플러그인은 보통 자기 AAR 안에 consumer-rules.pro를 함께 배포해 이 설정 없이도 스스로를
# 지키지만, 혹시 몰라 앱 쪽에도 명시적으로 걸어 둔다 - 중복이어도 해롭지 않다.)
-keep class com.getcapacitor.** { *; }
-keep public class * extends com.getcapacitor.Plugin
-keep @com.getcapacitor.annotation.CapacitorPlugin public class *
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
}
