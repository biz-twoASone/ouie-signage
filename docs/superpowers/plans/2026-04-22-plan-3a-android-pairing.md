# Plan 3a — Android TV APK: pairing & device auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a minimal Kotlin Android TV APK that boots into a pairing screen, mints tokens against the live Supabase backend via `pairing-request` → `pairing-status` → `devices-refresh`, stores them securely, and transitions to a placeholder "Running" screen. No config sync, no playback, no FCM, no heartbeat — those are Plans 3b and 3c.

**Architecture:** Single-module Gradle project at `android-tv/`, Kotlin + Compose for TV + OkHttp/Retrofit + kotlinx.serialization + EncryptedSharedPreferences + Koin for DI. Pairing state machine driven by a `StateFlow<AppState>` observed by MainActivity's Compose root. `TokenAuthenticator` serializes 401-triggered refresh via a mutex; on refresh failure the machine hard-resets to Pairing state and clears the TokenStore.

**Tech Stack:** Kotlin 2.1, Compose Multiplatform + androidx.tv.material3, Media3 (declared in Gradle but unused in 3a, pre-wired for 3b), OkHttp 4 + Retrofit 2 + kotlinx.serialization-json, androidx.security.crypto (EncryptedSharedPreferences), Koin 4, JUnit 4 + MockWebServer (JVM unit tests). Android minSdk 26 (Android 8 — required by Android TV tier), targetSdk 34, compileSdk 34.

**Out of scope for 3a (reserved for 3b/3c):**
- Config poller (/devices-config), media download, cache manager, SQLite index, preload scanner, schedule evaluator, ExoPlayer playback.
- FCM (FirebaseMessagingService), BOOT_COMPLETED receiver, foreground service.
- Heartbeat (/devices-heartbeat).
- Instrumented (Espresso) tests.
- Signed release build + Play Store; APK is debug-signed and sideloaded.

**Execution branch:** new branch `feature/plan-3a-android-pairing` off `main` after Plan 2.2 merges. If 2.2 is still on `feature/plan-2-dashboard`, branch from there and rebase later.

**End-of-plan commit:** `feat(android): plan 3a — pairing APK mints + stores device tokens end-to-end`

---

## Prerequisites — user must complete before Task 1.1

The agent cannot automate these; the user installs them once.

1. **Android Studio (Koala Feature Drop or later, recommended 2024.2+).**
   - Mac download: https://developer.android.com/studio
   - During install, accept the default SDK path `~/Library/Android/sdk`.
   - First-run wizard installs: Platform-Tools, Android SDK Platform 34, Android Emulator, Google APIs system images.
   - Confirm `~/Library/Android/sdk/platform-tools/adb` exists afterwards.

2. **Shell `PATH` additions** — append to `~/.zshrc`:
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
   ```
   Reload: `source ~/.zshrc`. Verify: `adb --version` prints a version.

3. **Android TV emulator image (optional but recommended for Task 6.1 smoke):**
   - Android Studio → Tools → AVD Manager → Create Virtual Device → category **TV** → Android TV (1080p) → system image **API 34 Google TV** → name `atv34`.
   - Launch once to confirm boot; ~3 min first time.

4. **One real Android TV available for Task 6.3.** The user's existing stores already have 2 TVs each; any one can be used. TV must support USB debugging (Settings → Device Preferences → About → tap Build 7 times → Developer options → ADB debugging ON) AND be on the same LAN as the Mac for `adb connect <tv-ip>:5555`.

**Agent check before starting Task 1.1:**
```bash
which adb && adb --version && ls "$ANDROID_HOME/platforms/android-34"
```
If any of these fail, STOP and ask the user to complete the prerequisites.

---

## File structure

**New directory:** `android-tv/` at the repo root (sibling of `dashboard/`, `supabase/`).

```
android-tv/
├── .gitignore
├── build.gradle.kts                   # root project build file (empty plugins DSL anchor)
├── settings.gradle.kts                # includes :app module
├── gradle.properties                  # AndroidX, JVM heap, Kotlin code style
├── gradle/
│   ├── libs.versions.toml             # version catalog (single source of truth for deps)
│   └── wrapper/
│       ├── gradle-wrapper.jar
│       └── gradle-wrapper.properties
├── gradlew                            # wrapper script (macOS/Linux)
├── gradlew.bat                        # wrapper script (Windows, included for portability)
└── app/
    ├── .gitignore
    ├── build.gradle.kts               # module build — plugins, android{}, dependencies{}
    ├── proguard-rules.pro             # empty-stub (no minification for debug)
    └── src/
        ├── main/
        │   ├── AndroidManifest.xml
        │   ├── java/com/ouie/signage/
        │   │   ├── MainActivity.kt            # entry point; observes AppStateHolder; switches screens
        │   │   ├── SignageApp.kt              # Application class; starts Koin
        │   │   ├── di/
        │   │   │   └── AppModule.kt           # Koin module: http client, api services, repository, token store
        │   │   ├── state/
        │   │   │   ├── AppState.kt            # sealed class: Pairing | Running | Error
        │   │   │   └── AppStateHolder.kt      # MutableStateFlow wrapper + transitions
        │   │   ├── auth/
        │   │   │   ├── DeviceTokens.kt        # @Serializable data class
        │   │   │   └── TokenStore.kt          # EncryptedSharedPreferences-backed persistence
        │   │   ├── net/
        │   │   │   ├── ApiClient.kt           # Retrofit factory + OkHttp configuration
        │   │   │   ├── AuthInterceptor.kt     # adds Bearer <access> header
        │   │   │   ├── TokenAuthenticator.kt  # OkHttp Authenticator — 401→refresh→retry
        │   │   │   ├── PairingApi.kt          # Retrofit interface for pairing-{request,status}
        │   │   │   └── DeviceApi.kt           # Retrofit interface for devices-refresh
        │   │   ├── pairing/
        │   │   │   ├── PairingRepository.kt   # wraps PairingApi; owns the polling loop
        │   │   │   ├── PairingViewModel.kt    # exposes PairingUiState via StateFlow
        │   │   │   └── PairingScreen.kt       # Compose UI
        │   │   ├── running/
        │   │   │   └── RunningScreen.kt       # placeholder ("Paired as <name>; waiting for content")
        │   │   └── error/
        │   │       └── ErrorScreen.kt         # displays ErrorKind + retry CTA or auto-retry countdown
        │   └── res/
        │       ├── values/
        │       │   ├── strings.xml
        │       │   └── themes.xml             # TV Material3 base theme
        │       ├── drawable/
        │       │   └── banner.xml             # stub TV launcher banner (required for LEANBACK_LAUNCHER)
        │       └── xml/
        │           └── backup_rules.xml       # exclude token store from auto-backup (secrets)
        └── test/
            └── java/com/ouie/signage/
                ├── net/TokenAuthenticatorTest.kt
                ├── pairing/PairingRepositoryTest.kt
                └── state/AppStateHolderTest.kt
```

**Modified:**
- `CLAUDE.md` — add Plan 3a pointer + Android tooling prereqs section.
- `.gitignore` at repo root — add Android-specific entries (`.gradle/`, `build/`, `*.apk`, `local.properties`, `.idea/`).

---

# Phase 1 — Gradle scaffold

Goal: a buildable empty APK that installs on an emulator, with no feature code yet.

### Task 1.1 — Create directory + root Gradle files

**Files:**
- Create: `android-tv/settings.gradle.kts`
- Create: `android-tv/build.gradle.kts`
- Create: `android-tv/gradle.properties`
- Create: `android-tv/.gitignore`
- Create: `android-tv/gradle/libs.versions.toml`

- [ ] **Step 1: Create the directory and root settings file**

```bash
mkdir -p android-tv/app/src/main/java/com/ouie/signage
mkdir -p android-tv/app/src/main/res/values
mkdir -p android-tv/app/src/main/res/drawable
mkdir -p android-tv/app/src/main/res/xml
mkdir -p android-tv/app/src/test/java/com/ouie/signage
mkdir -p android-tv/gradle
```

Write `android-tv/settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "signage-android-tv"
include(":app")
```

- [ ] **Step 2: Write root `build.gradle.kts`**

```kotlin
// android-tv/build.gradle.kts
// Top-level build file. All plugins declared `apply false` here;
// submodules pin versions via the version catalog.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
```

- [ ] **Step 3: Write `gradle.properties`**

```properties
# android-tv/gradle.properties
org.gradle.jvmargs=-Xmx4g -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
```

- [ ] **Step 4: Write `android-tv/.gitignore`**

```gitignore
.gradle/
build/
local.properties
.idea/
*.iml
.DS_Store
captures/
.externalNativeBuild/
.cxx/
*.hprof
```

- [ ] **Step 5: Write the version catalog `gradle/libs.versions.toml`**

```toml
# android-tv/gradle/libs.versions.toml
[versions]
agp = "8.7.2"
kotlin = "2.1.0"
coreKtx = "1.15.0"
activityCompose = "1.9.3"
composeBom = "2024.12.01"
tvMaterial = "1.0.0"
media3 = "1.5.1"
lifecycle = "2.8.7"
retrofit = "2.11.0"
okhttp = "4.12.0"
kotlinxSerialization = "1.7.3"
retrofitKotlinxSerialization = "1.0.0"
koin = "4.0.0"
securityCrypto = "1.1.0-alpha06"
junit = "4.13.2"
mockwebserver = "4.12.0"
kotlinxCoroutinesTest = "1.9.0"
turbine = "1.2.0"

[libraries]
androidx-core-ktx = { module = "androidx.core:core-ktx", version.ref = "coreKtx" }
androidx-activity-compose = { module = "androidx.activity:activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { module = "androidx.compose:compose-bom", version.ref = "composeBom" }
androidx-compose-ui = { module = "androidx.compose.ui:ui" }
androidx-compose-ui-tooling = { module = "androidx.compose.ui:ui-tooling" }
androidx-compose-ui-tooling-preview = { module = "androidx.compose.ui:ui-tooling-preview" }
androidx-compose-foundation = { module = "androidx.compose.foundation:foundation" }
androidx-tv-material3 = { module = "androidx.tv:tv-material", version.ref = "tvMaterial" }
androidx-lifecycle-runtime-ktx = { module = "androidx.lifecycle:lifecycle-runtime-ktx", version.ref = "lifecycle" }
androidx-lifecycle-viewmodel-compose = { module = "androidx.lifecycle:lifecycle-viewmodel-compose", version.ref = "lifecycle" }
androidx-media3-exoplayer = { module = "androidx.media3:media3-exoplayer", version.ref = "media3" }
androidx-media3-ui = { module = "androidx.media3:media3-ui", version.ref = "media3" }
androidx-security-crypto = { module = "androidx.security:security-crypto", version.ref = "securityCrypto" }

retrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }
retrofit-kotlinx-serialization = { module = "com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter", version.ref = "retrofitKotlinxSerialization" }
okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }
okhttp-logging = { module = "com.squareup.okhttp3:logging-interceptor", version.ref = "okhttp" }
okhttp-mockwebserver = { module = "com.squareup.okhttp3:mockwebserver", version.ref = "mockwebserver" }
kotlinx-serialization-json = { module = "org.jetbrains.kotlinx:kotlinx-serialization-json", version.ref = "kotlinxSerialization" }

koin-android = { module = "io.insert-koin:koin-android", version.ref = "koin" }
koin-androidx-compose = { module = "io.insert-koin:koin-androidx-compose", version.ref = "koin" }

junit = { module = "junit:junit", version.ref = "junit" }
kotlinx-coroutines-test = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version.ref = "kotlinxCoroutinesTest" }
turbine = { module = "app.cash.turbine:turbine", version.ref = "turbine" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

- [ ] **Step 6: Generate the Gradle wrapper**

```bash
cd android-tv
# Use any system gradle to bootstrap; if unavailable, copy wrapper from a fresh Android Studio-generated project.
# Simpler: fetch the wrapper jar directly.
mkdir -p gradle/wrapper
curl -sSL -o gradle/wrapper/gradle-wrapper.jar \
  https://raw.githubusercontent.com/gradle/gradle/v8.11.1/gradle/wrapper/gradle-wrapper.jar
cat > gradle/wrapper/gradle-wrapper.properties <<'EOF'
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.11.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
EOF
curl -sSL -o gradlew https://raw.githubusercontent.com/gradle/gradle/v8.11.1/gradlew
curl -sSL -o gradlew.bat https://raw.githubusercontent.com/gradle/gradle/v8.11.1/gradlew.bat
chmod +x gradlew
```

Expected: `gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties` exist. Running `./gradlew --version` should print Gradle 8.11.1 (will download distribution on first run; allow ~60s).

- [ ] **Step 7: Commit**

```bash
git add android-tv/settings.gradle.kts android-tv/build.gradle.kts \
        android-tv/gradle.properties android-tv/.gitignore \
        android-tv/gradle/libs.versions.toml \
        android-tv/gradle/wrapper/ android-tv/gradlew android-tv/gradlew.bat
git commit -m "feat(android): gradle scaffold + wrapper + version catalog"
```

### Task 1.2 — App module `build.gradle.kts`

**Files:**
- Create: `android-tv/app/build.gradle.kts`
- Create: `android-tv/app/.gitignore`
- Create: `android-tv/app/proguard-rules.pro`

- [ ] **Step 1: Write `app/build.gradle.kts`**

```kotlin
// android-tv/app/build.gradle.kts
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.ouie.signage"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ouie.signage"
        minSdk = 26              // Android TV 8.0 floor; current F&B TVs are newer
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-3a"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Baked at build time from env or gradle.properties (see README for override).
        val supabaseUrl = (project.findProperty("SUPABASE_URL") as String?)
            ?: System.getenv("SUPABASE_URL")
            ?: "https://swhwrlpoqjijxcvywzto.supabase.co"
        buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false                // no obfuscation in v1 — logs readable
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/LICENSE*",
                "/META-INF/NOTICE*",
            )
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.tv.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Media3 declared for 3b; unused here but pinned once.
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.ui)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.koin.android)
    implementation(libs.koin.androidx.compose)

    implementation(libs.androidx.security.crypto)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
}
```

- [ ] **Step 2: Write `app/.gitignore`**

```gitignore
build/
```

- [ ] **Step 3: Write empty `app/proguard-rules.pro`**

```proguard
# Keep everything for v1. Enable minification in a later plan once stable.
```

- [ ] **Step 4: Run `./gradlew :app:help` to validate the module is recognized**

```bash
cd android-tv && ./gradlew :app:help
```

Expected: BUILD SUCCESSFUL. Will download AGP + Kotlin compiler plugins on first run (~2 min, network dependent).

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/build.gradle.kts android-tv/app/.gitignore android-tv/app/proguard-rules.pro
git commit -m "feat(android): app module — AGP, Compose, OkHttp, Koin, Media3 dependencies"
```

### Task 1.3 — Android manifest + launcher + placeholder entry point

**Files:**
- Create: `android-tv/app/src/main/AndroidManifest.xml`
- Create: `android-tv/app/src/main/res/values/strings.xml`
- Create: `android-tv/app/src/main/res/values/themes.xml`
- Create: `android-tv/app/src/main/res/drawable/banner.xml`
- Create: `android-tv/app/src/main/res/xml/backup_rules.xml`
- Create: `android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt`

- [ ] **Step 1: Write `AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <!-- Android TV form-factor declaration. Touchscreen explicitly not required
         so Google Play's TV DAC doesn't flag the APK (v1.1 concern; harmless now). -->
    <uses-feature android:name="android.software.leanback" android:required="true" />
    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />

    <application
        android:name=".SignageApp"
        android:label="@string/app_name"
        android:banner="@drawable/banner"
        android:icon="@drawable/banner"
        android:theme="@style/Theme.SignageTv"
        android:allowBackup="false"
        android:fullBackupContent="@xml/backup_rules"
        tools:targetApi="34">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="landscape"
            android:theme="@style/Theme.SignageTv">

            <!-- Appears in the Android TV home launcher -->
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

- [ ] **Step 2: Write `res/values/strings.xml`**

```xml
<resources>
    <string name="app_name">Signage Player</string>
    <string name="pairing_title">Pair this TV</string>
    <string name="pairing_instructions">Enter this code in your dashboard:</string>
    <string name="pairing_code_expires_in">Code expires in %1$d seconds</string>
    <string name="pairing_waiting">Waiting for pairing…</string>
    <string name="running_placeholder">Paired. Waiting for content…</string>
    <string name="error_generic">Something went wrong</string>
    <string name="error_retry_in">Retrying in %1$d s</string>
</resources>
```

- [ ] **Step 3: Write `res/values/themes.xml`**

```xml
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.SignageTv" parent="android:Theme.Material.NoActionBar">
        <item name="android:windowBackground">@android:color/black</item>
        <item name="android:statusBarColor" tools:targetApi="21">@android:color/black</item>
    </style>
</resources>
```

(The Compose TV theme is set in code; this XML theme only covers the Activity chrome.)

- [ ] **Step 4: Write `res/drawable/banner.xml` (stub 320×180 TV banner)**

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <size android:width="320dp" android:height="180dp" />
    <solid android:color="#111111" />
    <stroke android:width="1dp" android:color="#444444" />
</shape>
```

- [ ] **Step 5: Write `res/xml/backup_rules.xml` (exclude token store from backup)**

```xml
<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <!-- EncryptedSharedPreferences is device-keyed; backing it up would be useless
         AND a leakage risk. Exclude explicitly. -->
    <exclude domain="sharedpref" path="signage_tokens.xml" />
</full-backup-content>
```

- [ ] **Step 6: Write the Application class `SignageApp.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt
package com.ouie.signage

import android.app.Application
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class SignageApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Koin module is added in Task 2.2; for now start empty-module Koin so
        // the Application onCreate doesn't throw when module list is extended later.
        startKoin {
            androidContext(this@SignageApp)
        }
    }
}
```

- [ ] **Step 7: Write a placeholder `MainActivity.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
package com.ouie.signage

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { BootScreen() }
    }
}

@Composable
private fun BootScreen() {
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Text("Signage Player — Plan 3a scaffold", color = Color.White)
    }
}
```

- [ ] **Step 8: Assemble a debug APK to confirm the scaffold builds**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL, APK at `android-tv/app/build/outputs/apk/debug/app-debug.apk`. First run may take 5 min (Kotlin compilation, R8, resource processing). Subsequent ~20 s.

- [ ] **Step 9: Commit**

```bash
git add android-tv/app/src/main/
git commit -m "feat(android): manifest + launcher + placeholder MainActivity — assembleDebug passes"
```

---

# Phase 2 — State machine + DI

Goal: a `StateFlow<AppState>` that MainActivity observes to switch between Pairing, Running, Error.

### Task 2.1 — `AppState` sealed class + holder

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/state/AppState.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/state/AppStateHolder.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/state/AppStateHolderTest.kt`

- [ ] **Step 1: Write the failing test first**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/state/AppStateHolderTest.kt
package com.ouie.signage.state

import app.cash.turbine.test
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AppStateHolderTest {
    @Test
    fun `initial state is Pairing`() = runTest {
        val holder = AppStateHolder()
        holder.state.test {
            assertEquals(AppState.Pairing, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `transition to Running emits new state`() = runTest {
        val holder = AppStateHolder()
        holder.toRunning(deviceId = "dev-1")
        holder.state.test {
            val first = awaitItem()
            assertEquals(AppState.Running(deviceId = "dev-1"), first)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `transition to Error emits with kind`() = runTest {
        val holder = AppStateHolder()
        holder.toError(AppState.ErrorKind.NetworkUnavailable)
        holder.state.test {
            val first = awaitItem()
            assertEquals(AppState.Error(AppState.ErrorKind.NetworkUnavailable), first)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `recoverToPairing from Error resets`() = runTest {
        val holder = AppStateHolder()
        holder.toError(AppState.ErrorKind.TokensInvalid)
        holder.recoverToPairing()
        holder.state.test {
            assertEquals(AppState.Pairing, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }
}
```

- [ ] **Step 2: Run — expect RED (AppState doesn't exist yet)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.state.AppStateHolderTest"
```

Expected: COMPILATION FAILED on unresolved `AppState` / `AppStateHolder`.

- [ ] **Step 3: Write `AppState.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/state/AppState.kt
package com.ouie.signage.state

sealed interface AppState {
    data object Pairing : AppState
    data class Running(val deviceId: String) : AppState
    data class Error(val kind: ErrorKind) : AppState

    enum class ErrorKind {
        NetworkUnavailable,  // transient; auto-retry after countdown
        ServerUnavailable,   // 5xx from Supabase; auto-retry
        TokensInvalid,       // refresh 401 — must re-pair
        Unknown,             // catch-all; auto-retry
    }
}
```

- [ ] **Step 4: Write `AppStateHolder.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/state/AppStateHolder.kt
package com.ouie.signage.state

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Single source of truth for the UI state of the app. MainActivity observes
 * `state` and renders the appropriate Compose screen; repositories emit into
 * it via the transition methods.
 */
class AppStateHolder {
    private val _state = MutableStateFlow<AppState>(AppState.Pairing)
    val state: StateFlow<AppState> = _state.asStateFlow()

    fun toRunning(deviceId: String) {
        _state.value = AppState.Running(deviceId)
    }

    fun toError(kind: AppState.ErrorKind) {
        _state.value = AppState.Error(kind)
    }

    fun recoverToPairing() {
        _state.value = AppState.Pairing
    }
}
```

- [ ] **Step 5: Run tests — expect GREEN (4 passed)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.state.AppStateHolderTest"
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/state/ \
        android-tv/app/src/test/java/com/ouie/signage/state/
git commit -m "feat(android): AppState sealed interface + StateFlow holder with transitions"
```

### Task 2.2 — Koin module for singletons

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt`

- [ ] **Step 1: Write `AppModule.kt` (skeleton — fleshed out in Phase 3)**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
package com.ouie.signage.di

import com.ouie.signage.state.AppStateHolder
import org.koin.dsl.module

val appModule = module {
    single { AppStateHolder() }
    // Phase 3 additions: TokenStore, OkHttpClient, Retrofit, PairingApi, DeviceApi, PairingRepository
}
```

- [ ] **Step 2: Modify `SignageApp.kt` to register the module**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt
package com.ouie.signage

import android.app.Application
import com.ouie.signage.di.appModule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class SignageApp : Application() {
    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidContext(this@SignageApp)
            modules(appModule)
        }
    }
}
```

- [ ] **Step 3: Assemble to confirm no Koin resolution errors at startup**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL. (True startup test is Task 6.1 when the APK runs on an emulator.)

- [ ] **Step 4: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/di/ \
        android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt
git commit -m "feat(android): Koin bootstrap — appModule with AppStateHolder singleton"
```

---

# Phase 3 — Auth + network layer

Goal: `TokenAuthenticator` turns 401 into a refresh-and-retry. `TokenStore` persists secrets.

### Task 3.1 — `DeviceTokens` + `TokenStore`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/auth/DeviceTokens.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/auth/TokenStore.kt`

- [ ] **Step 1: Write `DeviceTokens.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/auth/DeviceTokens.kt
package com.ouie.signage.auth

import kotlinx.serialization.Serializable

@Serializable
data class DeviceTokens(
    val accessToken: String,
    val refreshToken: String,
    val deviceId: String,
    val expiresInSeconds: Int,
)
```

- [ ] **Step 2: Write `TokenStore.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/auth/TokenStore.kt
package com.ouie.signage.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Persists device tokens in EncryptedSharedPreferences. Access token is kept in
 * memory via the MutableStateFlow; only the refresh_token + device_id survive
 * process death. When MainActivity starts, it reads these back and asks the
 * refresh endpoint for a fresh access token.
 *
 * File name `signage_tokens.xml` is excluded from Android auto-backup via
 * res/xml/backup_rules.xml.
 */
class TokenStore(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "signage_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun load(): PersistedTokens? {
        val refresh = prefs.getString(KEY_REFRESH, null) ?: return null
        val deviceId = prefs.getString(KEY_DEVICE_ID, null) ?: return null
        val access = prefs.getString(KEY_ACCESS, null) // may be null (RAM-only in v1)
        return PersistedTokens(refreshToken = refresh, deviceId = deviceId, lastAccessToken = access)
    }

    fun save(tokens: DeviceTokens) {
        prefs.edit()
            .putString(KEY_REFRESH, tokens.refreshToken)
            .putString(KEY_DEVICE_ID, tokens.deviceId)
            .putString(KEY_ACCESS, tokens.accessToken)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    data class PersistedTokens(
        val refreshToken: String,
        val deviceId: String,
        val lastAccessToken: String?,
    )

    private companion object {
        const val KEY_REFRESH = "refresh_token"
        const val KEY_ACCESS = "access_token"
        const val KEY_DEVICE_ID = "device_id"
    }
}
```

- [ ] **Step 3: Commit** (no unit test — EncryptedSharedPreferences requires Android context and isn't worth a Robolectric shim in 3a; real-hardware Task 6.3 verifies)

```bash
git add android-tv/app/src/main/java/com/ouie/signage/auth/
git commit -m "feat(android): DeviceTokens data class + EncryptedSharedPreferences TokenStore"
```

### Task 3.2 — Retrofit + OkHttp bootstrap (no auth yet)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/ApiClient.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/PairingApi.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/DeviceApi.kt`

- [ ] **Step 1: Write `ApiClient.kt` — factory for Retrofit instance targeting pairing endpoints (NO auth interceptor yet; pairing calls don't need a token)**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/ApiClient.kt
package com.ouie.signage.net

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.ouie.signage.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

object ApiClient {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    /**
     * Shared OkHttp used by both pairing (no auth) and device (auth-required) retrofits.
     * Caller layers an Authenticator on top for device calls (Task 3.5).
     */
    fun baseHttpClient(): OkHttpClient.Builder {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                    else HttpLoggingInterceptor.Level.BASIC
            // Redact auth header even in BODY-level logs.
            redactHeader("Authorization")
        }
        return OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(logging)
    }

    fun retrofit(client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
}
```

- [ ] **Step 2: Write `PairingApi.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/PairingApi.kt
package com.ouie.signage.net

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface PairingApi {
    @POST("pairing-request")
    suspend fun requestCode(@Body body: PairingRequestBody): PairingRequestResponse

    @GET("pairing-status")
    suspend fun status(@Query("code") code: String): Response<PairingStatusResponse>
}

@Serializable
data class PairingRequestBody(val device_proposed_name: String? = null)

@Serializable
data class PairingRequestResponse(val code: String, val expires_at: String)

/**
 * The server uses a single endpoint with a `status` discriminator:
 *  - "pending"                → keep polling
 *  - "expired"                → request a new code
 *  - "paired"                 → first read after claim: pickup bundle present
 *  - "paired_pickup_consumed" → we (or a stale poller) already drained the pickup
 *                                — if we see this without having persisted tokens,
 *                                we must re-pair.
 */
@Serializable
data class PairingStatusResponse(
    val status: String,
    val device_id: String? = null,
    val access_token: String? = null,
    val refresh_token: String? = null,
    val expires_in: Int? = null,
)
```

- [ ] **Step 3: Write `DeviceApi.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/DeviceApi.kt
package com.ouie.signage.net

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface DeviceApi {
    @POST("devices-refresh")
    suspend fun refresh(@Body body: RefreshBody): Response<RefreshResponse>
}

@Serializable
data class RefreshBody(val refresh_token: String)

@Serializable
data class RefreshResponse(
    val access_token: String,
    val refresh_token: String,
    val expires_in: Int,
)
```

- [ ] **Step 4: Compile**

```bash
cd android-tv && ./gradlew :app:compileDebugKotlin
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/net/
git commit -m "feat(android): Retrofit scaffolding — PairingApi + DeviceApi + ApiClient"
```

### Task 3.3 — `AuthInterceptor` + mutex-serialized `TokenAuthenticator`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/AuthInterceptor.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/TokenAuthenticator.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/net/TokenAuthenticatorTest.kt`

- [ ] **Step 1: Write the failing test first**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/net/TokenAuthenticatorTest.kt
package com.ouie.signage.net

import com.ouie.signage.auth.DeviceTokens
import com.ouie.signage.auth.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

class TokenAuthenticatorTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `401 triggers refresh and retries original request`() = runTest {
        // Arrange: original call 401s, then returns 200 on retry.
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200).setBody("ok"))

        val tokenStore = FakeTokenStore(
            initial = DeviceTokens(
                accessToken = "old",
                refreshToken = "rt1",
                deviceId = "dev-1",
                expiresInSeconds = 3600,
            ),
        )
        val refreshAdapter = FakeRefreshAdapter { DeviceTokens(
            accessToken = "new",
            refreshToken = "rt2",
            deviceId = "dev-1",
            expiresInSeconds = 3600,
        ) }
        val authenticator = TokenAuthenticator(
            tokenStore = tokenStore,
            refreshAdapter = refreshAdapter,
        )

        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenStore))
            .authenticator(authenticator)
            .build()

        val response = client.newCall(
            Request.Builder().url(server.url("/devices-heartbeat")).build()
        ).execute()

        assertEquals(200, response.code)
        assertEquals("Bearer new", server.takeRequest(); server.takeRequest().getHeader("Authorization"))
        // Note: consume the first request above; assertion is on the retry.
    }

    @Test
    fun `concurrent 401s share a single refresh`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200).setBody("one"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("two"))

        val tokenStore = FakeTokenStore(
            initial = DeviceTokens("old", "rt1", "dev-1", 3600),
        )
        val refreshCount = AtomicReference(0)
        val refreshAdapter = FakeRefreshAdapter {
            refreshCount.getAndUpdate { it + 1 }
            // Simulate a slow refresh so two callers can race.
            Thread.sleep(100)
            DeviceTokens("new", "rt2", "dev-1", 3600)
        }
        val authenticator = TokenAuthenticator(tokenStore, refreshAdapter)
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenStore))
            .authenticator(authenticator)
            .build()

        val r1 = Thread { client.newCall(Request.Builder().url(server.url("/a")).build()).execute() }
        val r2 = Thread { client.newCall(Request.Builder().url(server.url("/b")).build()).execute() }
        r1.start(); r2.start(); r1.join(); r2.join()

        assertEquals(1, refreshCount.get())  // only ONE refresh happened despite two 401s
    }

    @Test
    fun `refresh 401 clears the token store`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))

        val tokenStore = FakeTokenStore(
            initial = DeviceTokens("old", "rt1", "dev-1", 3600),
        )
        val refreshAdapter = FakeRefreshAdapter { throw RefreshFailedException() }
        val authenticator = TokenAuthenticator(tokenStore, refreshAdapter)
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenStore))
            .authenticator(authenticator)
            .build()

        val response = client.newCall(
            Request.Builder().url(server.url("/x")).build()
        ).execute()

        assertEquals(401, response.code)
        assertEquals(null, tokenStore.loadSync())
    }
}

/** Minimal TokenStore stand-in — production uses EncryptedSharedPreferences. */
private class FakeTokenStore(initial: DeviceTokens?) {
    private var tokens: DeviceTokens? = initial
    fun loadSync(): DeviceTokens? = tokens
    fun save(t: DeviceTokens) { tokens = t }
    fun clear() { tokens = null }
}

private class FakeRefreshAdapter(
    private val produce: suspend () -> DeviceTokens,
) : RefreshAdapter {
    override suspend fun refresh(current: DeviceTokens): DeviceTokens = produce()
}

class RefreshFailedException : Exception()
```

Note: the test uses a `FakeTokenStore` which stands in for the real `TokenStore`. The production classes `AuthInterceptor` and `TokenAuthenticator` must accept a common interface, not the concrete `TokenStore` — this is why Step 2 below introduces a `TokenSource` interface.

- [ ] **Step 2: Run — expect RED (types don't exist)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.net.TokenAuthenticatorTest"
```

Expected: COMPILATION FAILED.

- [ ] **Step 3: Introduce minimal interfaces the test expects**

Rewrite the test's `FakeTokenStore` block above, replacing with references to production interfaces. First, in production code add:

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/RefreshAdapter.kt
package com.ouie.signage.net

import com.ouie.signage.auth.DeviceTokens

/**
 * Abstraction over "do a refresh call against the server". Factored out so
 * TokenAuthenticator doesn't depend on a Retrofit interface directly —
 * easier to test and easier to swap the transport layer later.
 */
interface RefreshAdapter {
    suspend fun refresh(current: DeviceTokens): DeviceTokens
}
```

Then make `TokenStore` implement a `TokenSource` interface so the fake in tests can also implement it:

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/auth/TokenSource.kt
package com.ouie.signage.auth

/**
 * Read/write interface over token persistence. Production: TokenStore (EncryptedSharedPreferences).
 * Test: FakeTokenStore (in-memory).
 */
interface TokenSource {
    fun loadSync(): DeviceTokens?
    fun save(tokens: DeviceTokens)
    fun clear()
}
```

Then modify `TokenStore` to implement it (update `load()` to return `DeviceTokens?` by deriving access token from `lastAccessToken` field of `PersistedTokens`):

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/auth/TokenStore.kt (replace file body)
package com.ouie.signage.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class TokenStore(context: Context) : TokenSource {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "signage_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun loadSync(): DeviceTokens? {
        val refresh = prefs.getString(KEY_REFRESH, null) ?: return null
        val access = prefs.getString(KEY_ACCESS, null) ?: return null
        val deviceId = prefs.getString(KEY_DEVICE_ID, null) ?: return null
        val expiresIn = prefs.getInt(KEY_EXPIRES_IN, 3600)
        return DeviceTokens(access, refresh, deviceId, expiresIn)
    }

    override fun save(tokens: DeviceTokens) {
        prefs.edit()
            .putString(KEY_ACCESS, tokens.accessToken)
            .putString(KEY_REFRESH, tokens.refreshToken)
            .putString(KEY_DEVICE_ID, tokens.deviceId)
            .putInt(KEY_EXPIRES_IN, tokens.expiresInSeconds)
            .apply()
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_REFRESH = "refresh_token"
        const val KEY_ACCESS = "access_token"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_EXPIRES_IN = "expires_in"
    }
}
```

Now fix the test's `FakeTokenStore` to implement `TokenSource`:

```kotlin
// in TokenAuthenticatorTest.kt, replace the private FakeTokenStore class:
private class FakeTokenStore(initial: DeviceTokens?) : com.ouie.signage.auth.TokenSource {
    private var tokens: DeviceTokens? = initial
    override fun loadSync(): DeviceTokens? = tokens
    override fun save(tokens: DeviceTokens) { this.tokens = tokens }
    override fun clear() { tokens = null }
}
```

- [ ] **Step 4: Write `AuthInterceptor.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/AuthInterceptor.kt
package com.ouie.signage.net

import com.ouie.signage.auth.TokenSource
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Appends `Authorization: Bearer <accessToken>` on every outbound request iff
 * the store currently has tokens. Missing tokens (= not yet paired) means the
 * request goes out unauthenticated — the server will respond appropriately.
 */
class AuthInterceptor(private val source: TokenSource) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val token = source.loadSync()?.accessToken
        val withAuth = if (token == null) req
                       else req.newBuilder().header("Authorization", "Bearer $token").build()
        return chain.proceed(withAuth)
    }
}
```

- [ ] **Step 5: Write `TokenAuthenticator.kt` with mutex**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/TokenAuthenticator.kt
package com.ouie.signage.net

import com.ouie.signage.auth.TokenSource
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * Invoked by OkHttp when a 401 happens. Runs the refresh flow under a mutex so
 * concurrent 401s share one refresh round-trip. If refresh itself fails
 * (any exception), clears the TokenSource and returns null — which makes
 * OkHttp surface the 401 to the caller (who routes it to Pairing state).
 *
 * Suspend bridge: OkHttp's Authenticator.authenticate() is blocking; we bridge
 * to the suspend refresh via runBlocking. The mutex prevents the classic
 * "two concurrent 401s = two refreshes" race (which would have invalidated
 * each other's refresh tokens via server-side CAS rotation).
 */
class TokenAuthenticator(
    private val tokenStore: TokenSource,
    private val refreshAdapter: RefreshAdapter,
) : Authenticator {

    private val mutex = Mutex()

    override fun authenticate(route: Route?, response: Response): Request? {
        val current = tokenStore.loadSync() ?: return null
        val requestAccess = response.request.header("Authorization")
            ?.removePrefix("Bearer ")?.trim()

        return runBlocking {
            mutex.withLock {
                // Double-check: if another caller already refreshed while we waited
                // for the mutex, our token has changed under us — retry with the
                // store's current value rather than refreshing again.
                val maybeRotated = tokenStore.loadSync()
                if (maybeRotated != null && maybeRotated.accessToken != requestAccess) {
                    return@withLock response.request.newBuilder()
                        .header("Authorization", "Bearer ${maybeRotated.accessToken}")
                        .build()
                }
                try {
                    val next = refreshAdapter.refresh(current)
                    tokenStore.save(next)
                    response.request.newBuilder()
                        .header("Authorization", "Bearer ${next.accessToken}")
                        .build()
                } catch (t: Throwable) {
                    tokenStore.clear()
                    null
                }
            }
        }
    }
}
```

- [ ] **Step 6: Run tests — expect GREEN**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.net.TokenAuthenticatorTest"
```

Expected: 3 tests pass. If the "concurrent 401s" test is flaky, increase `Thread.sleep(100)` to `300` in the FakeRefreshAdapter.

- [ ] **Step 7: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/net/ \
        android-tv/app/src/main/java/com/ouie/signage/auth/ \
        android-tv/app/src/test/java/com/ouie/signage/net/
git commit -m "feat(android): AuthInterceptor + mutex-serialized TokenAuthenticator"
```

### Task 3.4 — `RetrofitRefreshAdapter` + wire into Koin

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/RetrofitRefreshAdapter.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`

- [ ] **Step 1: Write `RetrofitRefreshAdapter.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/RetrofitRefreshAdapter.kt
package com.ouie.signage.net

import com.ouie.signage.auth.DeviceTokens

class RetrofitRefreshAdapter(
    private val deviceApi: DeviceApi,
) : RefreshAdapter {
    override suspend fun refresh(current: DeviceTokens): DeviceTokens {
        val resp = deviceApi.refresh(RefreshBody(refresh_token = current.refreshToken))
        if (!resp.isSuccessful) throw RefreshFailedException(resp.code())
        val body = resp.body() ?: throw RefreshFailedException(-1)
        return DeviceTokens(
            accessToken = body.access_token,
            refreshToken = body.refresh_token,
            deviceId = current.deviceId,                  // server doesn't echo this
            expiresInSeconds = body.expires_in,
        )
    }
}

class RefreshFailedException(val httpCode: Int) : Exception("refresh failed: $httpCode")
```

- [ ] **Step 2: Modify `AppModule.kt` to register the full graph**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
package com.ouie.signage.di

import com.ouie.signage.auth.TokenSource
import com.ouie.signage.auth.TokenStore
import com.ouie.signage.net.ApiClient
import com.ouie.signage.net.AuthInterceptor
import com.ouie.signage.net.DeviceApi
import com.ouie.signage.net.PairingApi
import com.ouie.signage.net.RefreshAdapter
import com.ouie.signage.net.RetrofitRefreshAdapter
import com.ouie.signage.net.TokenAuthenticator
import com.ouie.signage.pairing.PairingRepository
import com.ouie.signage.state.AppStateHolder
import okhttp3.OkHttpClient
import org.koin.android.ext.koin.androidContext
import org.koin.dsl.module

val appModule = module {
    single { AppStateHolder() }

    // Token persistence
    single<TokenSource> { TokenStore(androidContext()) }

    // Unauthenticated client for pairing calls (no Authenticator, no interceptor)
    single(qualifier = org.koin.core.qualifier.named("pairing")) {
        ApiClient.baseHttpClient().build()
    }
    single { ApiClient.retrofit(get(qualifier = org.koin.core.qualifier.named("pairing"))).create(PairingApi::class.java) }

    // DeviceApi retrofit uses a separate client WITHOUT the authenticator —
    // needed to break a chicken-and-egg during the refresh call itself.
    single(qualifier = org.koin.core.qualifier.named("device_refresh")) {
        ApiClient.baseHttpClient().build()
    }
    single {
        ApiClient.retrofit(get(qualifier = org.koin.core.qualifier.named("device_refresh")))
            .create(DeviceApi::class.java)
    }
    single<RefreshAdapter> { RetrofitRefreshAdapter(get()) }

    // Authenticated client for everything else (used by 3b/3c endpoints; defined
    // here so the DI graph is complete for integration testing on real hardware).
    single(qualifier = org.koin.core.qualifier.named("authed")) {
        ApiClient.baseHttpClient()
            .addInterceptor(AuthInterceptor(get()))
            .authenticator(TokenAuthenticator(get(), get()))
            .build()
    }

    single { PairingRepository(get(), get()) }  // PairingRepository is written in Task 4.1
}
```

- [ ] **Step 3: Compile**

```bash
cd android-tv && ./gradlew :app:compileDebugKotlin
```

Expected: COMPILATION FAILED on `PairingRepository` — that's fine; we're wiring DI ahead so Task 4.1 only has to write the class. If this is blocking, temporarily comment out the `single { PairingRepository(...) }` line and un-comment in Task 4.1 Step 4.

- [ ] **Step 4: Commit** (without the PairingRepository line committed — leave it commented or uncommit it from index)

```bash
git add android-tv/app/src/main/java/com/ouie/signage/net/RetrofitRefreshAdapter.kt \
        android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
git commit -m "feat(android): RetrofitRefreshAdapter + Koin graph for pairing/device/authed clients"
```

---

# Phase 4 — Pairing flow

Goal: `PairingRepository` owns the request-code + poll-status lifecycle; `PairingViewModel` exposes UI state; `PairingScreen` renders.

### Task 4.1 — `PairingRepository`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/pairing/PairingRepository.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/pairing/PairingRepositoryTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/pairing/PairingRepositoryTest.kt
package com.ouie.signage.pairing

import com.ouie.signage.net.PairingApi
import com.ouie.signage.net.PairingRequestBody
import com.ouie.signage.net.PairingRequestResponse
import com.ouie.signage.net.PairingStatusResponse
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

@OptIn(ExperimentalCoroutinesApi::class)
class PairingRepositoryTest {

    @Test
    fun `requestCode returns code + expiresAt`() = runTest {
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) =
                PairingRequestResponse(code = "ABC234", expires_at = "2026-04-22T12:00:00Z")
            override suspend fun status(code: String) = error("unused")
        }
        val repo = PairingRepository(api, proposedName = "TV-1")
        val (code, _) = repo.requestCode()
        assertEquals("ABC234", code)
    }

    @Test
    fun `observeClaim returns pending then paired`() = runTest {
        var calls = 0
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) = error("unused")
            override suspend fun status(code: String): Response<PairingStatusResponse> {
                calls++
                return if (calls < 3) {
                    Response.success(PairingStatusResponse(status = "pending"))
                } else {
                    Response.success(PairingStatusResponse(
                        status = "paired",
                        device_id = "dev-1",
                        access_token = "at",
                        refresh_token = "rt",
                        expires_in = 3600,
                    ))
                }
            }
        }
        val repo = PairingRepository(api, proposedName = "TV-1", pollIntervalMs = 10)
        val result = repo.observeClaim("ABC234")
        assertTrue(result is PairingRepository.ClaimResult.Paired)
        val paired = result as PairingRepository.ClaimResult.Paired
        assertEquals("dev-1", paired.tokens.deviceId)
        assertEquals("at", paired.tokens.accessToken)
        assertNotNull(paired.tokens.refreshToken)
    }

    @Test
    fun `observeClaim returns Expired when status flips to expired`() = runTest {
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) = error("unused")
            override suspend fun status(code: String) =
                Response.success(PairingStatusResponse(status = "expired"))
        }
        val repo = PairingRepository(api, proposedName = "TV-1", pollIntervalMs = 1)
        assertTrue(repo.observeClaim("ABC234") is PairingRepository.ClaimResult.Expired)
    }

    @Test
    fun `observeClaim returns PickupConsumed when tokens already drained`() = runTest {
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) = error("unused")
            override suspend fun status(code: String) =
                Response.success(PairingStatusResponse(
                    status = "paired_pickup_consumed",
                    device_id = "dev-1",
                ))
        }
        val repo = PairingRepository(api, proposedName = "TV-1", pollIntervalMs = 1)
        assertTrue(repo.observeClaim("ABC234") is PairingRepository.ClaimResult.PickupConsumed)
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Write `PairingRepository.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/pairing/PairingRepository.kt
package com.ouie.signage.pairing

import com.ouie.signage.auth.DeviceTokens
import com.ouie.signage.net.PairingApi
import com.ouie.signage.net.PairingRequestBody
import kotlinx.coroutines.delay

/**
 * Owns the two pairing endpoints. UI observes a suspending `observeClaim`
 * which polls until it gets a terminal status, then returns a `ClaimResult`.
 *
 * The `proposedName` is a human-readable hint the operator sees on the
 * dashboard claim form ("TV-kitchen-1"). In 3a we pass the Android Build.MODEL
 * by default; operators can rename post-claim from the dashboard.
 */
class PairingRepository(
    private val api: PairingApi,
    private val proposedName: String,
    private val pollIntervalMs: Long = 3_000,
) {
    data class PairingCode(val code: String, val expiresAtIso: String)

    sealed interface ClaimResult {
        data class Paired(val tokens: DeviceTokens) : ClaimResult
        data object Pending : ClaimResult         // never returned — observeClaim loops on Pending
        data object Expired : ClaimResult
        data object PickupConsumed : ClaimResult  // re-pair
        data class Error(val cause: Throwable) : ClaimResult
    }

    suspend fun requestCode(): PairingCode {
        val resp = api.requestCode(PairingRequestBody(device_proposed_name = proposedName))
        return PairingCode(resp.code, resp.expires_at)
    }

    /**
     * Polls `/pairing-status` every `pollIntervalMs` until a terminal state.
     * Caller is responsible for also tracking the 15-min TTL; we don't
     * preemptively expire since the server will flip status to "expired"
     * within one poll interval of the TTL.
     */
    suspend fun observeClaim(code: String): ClaimResult {
        while (true) {
            val resp = try {
                api.status(code)
            } catch (t: Throwable) {
                return ClaimResult.Error(t)
            }
            if (!resp.isSuccessful) {
                // 4xx/5xx — network layer problem; the ViewModel maps this to ErrorKind
                return ClaimResult.Error(RuntimeException("pairing-status HTTP ${resp.code()}"))
            }
            val body = resp.body() ?: return ClaimResult.Error(RuntimeException("empty body"))

            when (body.status) {
                "pending" -> delay(pollIntervalMs)
                "expired" -> return ClaimResult.Expired
                "paired" -> {
                    val at = body.access_token ?: return ClaimResult.PickupConsumed
                    val rt = body.refresh_token ?: return ClaimResult.PickupConsumed
                    val did = body.device_id ?: return ClaimResult.PickupConsumed
                    val exp = body.expires_in ?: 3600
                    return ClaimResult.Paired(DeviceTokens(at, rt, did, exp))
                }
                "paired_pickup_consumed" -> return ClaimResult.PickupConsumed
                else -> return ClaimResult.Error(RuntimeException("unknown status: ${body.status}"))
            }
        }
    }
}
```

Note: the Koin module in Task 3.4 registered `PairingRepository(get(), get())` with TWO args; adjust to match the constructor above. Update `AppModule.kt`:

```kotlin
// Change this line in AppModule.kt:
single { PairingRepository(api = get(), proposedName = android.os.Build.MODEL ?: "Android TV") }
```

- [ ] **Step 4: Run tests — expect GREEN**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.pairing.PairingRepositoryTest"
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/pairing/PairingRepository.kt \
        android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt \
        android-tv/app/src/test/java/com/ouie/signage/pairing/
git commit -m "feat(android): PairingRepository owns request-code + poll-status lifecycle"
```

### Task 4.2 — `PairingViewModel`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/pairing/PairingViewModel.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`

- [ ] **Step 1: Write `PairingViewModel.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/pairing/PairingViewModel.kt
package com.ouie.signage.pairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.state.AppState
import com.ouie.signage.state.AppStateHolder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Drives the Pairing screen:
 * 1. On init, request a code.
 * 2. Start polling `/pairing-status` every 3s.
 * 3. On Paired: persist tokens, transition AppState to Running.
 * 4. On Expired / PickupConsumed: request a new code and restart polling.
 * 5. On Error: surface via AppState.Error; auto-retry from ErrorScreen.
 */
class PairingViewModel(
    private val repo: PairingRepository,
    private val tokenStore: TokenSource,
    private val appState: AppStateHolder,
) : ViewModel() {

    data class UiState(
        val code: String? = null,
        val expiresAtIso: String? = null,
        val secondsUntilExpiry: Int = 0,
        val isRequesting: Boolean = true,
        val message: String? = null,
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    init {
        start()
    }

    private fun start() {
        viewModelScope.launch {
            loop()
        }
    }

    private suspend fun loop() {
        while (true) {
            _ui.value = UiState(isRequesting = true)
            val code = try {
                repo.requestCode()
            } catch (t: Throwable) {
                appState.toError(AppState.ErrorKind.ServerUnavailable)
                return
            }
            _ui.value = UiState(
                code = code.code,
                expiresAtIso = code.expiresAtIso,
                secondsUntilExpiry = secondsUntil(code.expiresAtIso),
                isRequesting = false,
            )

            when (val result = repo.observeClaim(code.code)) {
                is PairingRepository.ClaimResult.Paired -> {
                    tokenStore.save(result.tokens)
                    appState.toRunning(result.tokens.deviceId)
                    return
                }
                PairingRepository.ClaimResult.Expired,
                PairingRepository.ClaimResult.PickupConsumed -> {
                    _ui.value = _ui.value.copy(message = "Code expired — generating a new one…")
                    // loop — request a new code
                }
                is PairingRepository.ClaimResult.Error -> {
                    appState.toError(AppState.ErrorKind.NetworkUnavailable)
                    return
                }
                PairingRepository.ClaimResult.Pending -> {} // observeClaim never returns Pending
            }
        }
    }

    private fun secondsUntil(iso: String): Int =
        ((Instant.parse(iso).toEpochMilli() - System.currentTimeMillis()) / 1000).toInt()
            .coerceAtLeast(0)
}
```

- [ ] **Step 2: Modify `AppModule.kt` to add the ViewModel**

```kotlin
// append to AppModule.kt
import com.ouie.signage.pairing.PairingViewModel
import org.koin.core.module.dsl.viewModel  // add import

val appModule = module {
    // ... existing single {} entries ...
    viewModel { PairingViewModel(repo = get(), tokenStore = get(), appState = get()) }
}
```

If `viewModel` DSL is not resolvable, add `implementation("io.insert-koin:koin-androidx-compose:${libs.versions.koin.get()}")` — already in libs.versions.toml above.

- [ ] **Step 3: Compile**

```bash
cd android-tv && ./gradlew :app:compileDebugKotlin
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/pairing/PairingViewModel.kt \
        android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
git commit -m "feat(android): PairingViewModel drives code lifecycle + AppState transitions"
```

### Task 4.3 — `PairingScreen` Compose UI

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/pairing/PairingScreen.kt`

- [ ] **Step 1: Write `PairingScreen.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/pairing/PairingScreen.kt
package com.ouie.signage.pairing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.koin.androidx.compose.koinViewModel

@Composable
fun PairingScreen(viewModel: PairingViewModel = koinViewModel()) {
    val ui by viewModel.ui.collectAsState()

    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(64.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text(
                text = "Pair this TV",
                color = Color.White,
                fontSize = 32.sp,
                fontWeight = FontWeight.Light,
            )

            if (ui.isRequesting || ui.code == null) {
                CircularProgressIndicator(color = Color.White)
                Text("Requesting pairing code…", color = Color.Gray, fontSize = 16.sp)
            } else {
                Text(
                    text = "Enter this code in your dashboard:",
                    color = Color.Gray,
                    fontSize = 18.sp,
                )
                Text(
                    text = ui.code!!,
                    color = Color.White,
                    fontSize = 96.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                )
                CountdownText(expiresAtIso = ui.expiresAtIso)
            }
            ui.message?.let { Text(it, color = Color.Yellow, fontSize = 16.sp) }
        }
    }
}

@Composable
private fun CountdownText(expiresAtIso: String?) {
    if (expiresAtIso == null) return
    var remaining by remember(expiresAtIso) {
        mutableIntStateOf(
            ((java.time.Instant.parse(expiresAtIso).toEpochMilli() - System.currentTimeMillis()) / 1000)
                .toInt().coerceAtLeast(0)
        )
    }
    LaunchedEffect(expiresAtIso) {
        while (remaining > 0) {
            delay(1000)
            remaining -= 1
        }
    }
    Text(
        text = if (remaining > 0) "Code expires in $remaining s" else "Refreshing…",
        color = Color.Gray,
        fontSize = 14.sp,
    )
}
```

- [ ] **Step 2: Compile**

```bash
cd android-tv && ./gradlew :app:compileDebugKotlin
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/pairing/PairingScreen.kt
git commit -m "feat(android): PairingScreen Compose UI with live countdown"
```

---

# Phase 5 — Running + error screens + MainActivity wiring

### Task 5.1 — `RunningScreen` + `ErrorScreen`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/error/ErrorScreen.kt`

- [ ] **Step 1: Write `RunningScreen.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt
package com.ouie.signage.running

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun RunningScreen(deviceId: String) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(48.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "Paired successfully.\nDevice: $deviceId\nWaiting for content…",
            color = Color.White,
            fontSize = 24.sp,
        )
    }
}
```

- [ ] **Step 2: Write `ErrorScreen.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/error/ErrorScreen.kt
package com.ouie.signage.error

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ouie.signage.state.AppState
import kotlinx.coroutines.delay

@Composable
fun ErrorScreen(kind: AppState.ErrorKind, onRetry: () -> Unit) {
    val (title, detail, autoRetrySec) = when (kind) {
        AppState.ErrorKind.NetworkUnavailable ->
            Triple("No network", "Retrying automatically when the TV reconnects.", 10)
        AppState.ErrorKind.ServerUnavailable ->
            Triple("Can't reach our server", "Will retry shortly.", 10)
        AppState.ErrorKind.TokensInvalid ->
            Triple("Device needs re-pairing", "Starting pairing again…", 3)
        AppState.ErrorKind.Unknown ->
            Triple("Something went wrong", "Retrying shortly.", 10)
    }

    var remaining by remember(kind) { mutableIntStateOf(autoRetrySec) }
    LaunchedEffect(kind) {
        while (remaining > 0) {
            delay(1_000)
            remaining -= 1
        }
        onRetry()
    }

    Box(Modifier.fillMaxSize().background(Color.Black).padding(48.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(title, color = Color.White, fontSize = 28.sp)
            Text(detail, color = Color.Gray, fontSize = 18.sp)
            Text("Retrying in $remaining s", color = Color.Gray, fontSize = 14.sp)
        }
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/running/ \
        android-tv/app/src/main/java/com/ouie/signage/error/
git commit -m "feat(android): RunningScreen + ErrorScreen with auto-retry countdown"
```

### Task 5.2 — Wire `MainActivity` to state-driven navigation

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt`

- [ ] **Step 1: Rewrite `MainActivity.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
package com.ouie.signage

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.error.ErrorScreen
import com.ouie.signage.pairing.PairingScreen
import com.ouie.signage.running.RunningScreen
import com.ouie.signage.state.AppState
import com.ouie.signage.state.AppStateHolder
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private val appState: AppStateHolder by inject()
    private val tokenStore: TokenSource by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Cold-start recovery: if tokens are already persisted, go directly to Running.
        // Refresh on the first authed call (3b) will validate them; if invalid, the
        // Authenticator clears them and AppState flips back to Pairing.
        tokenStore.loadSync()?.let { appState.toRunning(it.deviceId) }

        setContent { SignageRoot(appState) }
    }
}

@Composable
private fun SignageRoot(appState: AppStateHolder) {
    val state by appState.state.collectAsState()
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when (val s = state) {
            AppState.Pairing -> PairingScreen()
            is AppState.Running -> RunningScreen(deviceId = s.deviceId)
            is AppState.Error -> ErrorScreen(
                kind = s.kind,
                onRetry = {
                    when (s.kind) {
                        AppState.ErrorKind.TokensInvalid -> appState.recoverToPairing()
                        else -> appState.recoverToPairing()  // pairing VM re-requests code
                    }
                },
            )
        }
    }
}
```

- [ ] **Step 2: Assemble — full stack should compile**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
git commit -m "feat(android): MainActivity observes AppState; cold-start skips pairing if tokens exist"
```

---

# Phase 6 — Integration smoke

### Task 6.1 — Install on emulator + screenshot verification

**Files:** none (acceptance task)

- [ ] **Step 1: Start the `atv34` emulator**

```bash
# Find the AVD name (should be atv34 from prerequisite step 3).
"$ANDROID_HOME/emulator/emulator" -list-avds
# Boot it headless; replace `atv34` if your AVD has a different name.
"$ANDROID_HOME/emulator/emulator" -avd atv34 -no-snapshot -no-boot-anim &
# Wait for boot:
adb wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done; echo booted'
```

- [ ] **Step 2: Install the debug APK**

```bash
cd android-tv && ./gradlew :app:installDebug
```

Expected: `Installed on 1 device.`

- [ ] **Step 3: Launch the app**

```bash
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

Expected: the pairing screen renders; `adb logcat -s SignageApp:* Koin:*` shows no crash.

- [ ] **Step 4: Capture a screenshot for the PR record**

```bash
adb exec-out screencap -p > /tmp/pairing-screen-emulator.png
# View in Finder:
open /tmp/pairing-screen-emulator.png
```

Expected: screenshot shows a 6-character code in large type + "Code expires in ~900 s".

- [ ] **Step 5: Claim the code from the live dashboard**

Open `https://signage-ouie.vercel.app/app/screens/add` in a browser, enter the code, pick a store, name the TV "Emulator Test", submit. The emulator screen should flip to "Paired successfully." within ≤3 seconds.

- [ ] **Step 6: Verify tokens survived process restart**

```bash
adb shell am force-stop com.ouie.signage.debug
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

Expected: app boots DIRECTLY into `RunningScreen` without going through pairing — `TokenStore.loadSync()` returned non-null on cold start (MainActivity Step 1 of this task).

- [ ] **Step 7: Commit an empty phase-close marker**

```bash
git commit --allow-empty -m "chore(android): Phase 6 emulator acceptance — pair + rehydrate verified"
```

### Task 6.2 — (optional if user has a real TV available today) Real-hardware smoke

**Files:** none

- [ ] **Step 1: Enable TV USB debugging + LAN ADB**

Per prerequisite step 4. Obtain the TV's LAN IP from Settings → Network.

- [ ] **Step 2: Connect from the Mac**

```bash
adb connect <tv-ip>:5555
adb devices   # the TV IP should be listed as "device"
```

- [ ] **Step 3: Install and launch**

```bash
cd android-tv && ./gradlew :app:installDebug
adb -s <tv-ip>:5555 shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

- [ ] **Step 4: Pair on the dashboard, verify**

Same as Task 6.1 Step 5, with "Physical TV" as the name. Confirm the TV screen reaches RunningScreen and dashboard `/app/screens` lists the new paired device with `last_seen_at = null` (expected; heartbeat is a 3b concern).

- [ ] **Step 5: Factory-style clear for idempotent retries**

```bash
adb -s <tv-ip>:5555 shell pm clear com.ouie.signage.debug
# and in the dashboard, delete the test device from /app/screens
```

- [ ] **Step 6: Commit**

```bash
git commit --allow-empty -m "chore(android): Phase 6 real-hardware acceptance — <brand/model> pair + rehydrate"
```

*If no real TV is available today, skip Task 6.2 and move to 6.3; defer real-hardware to a 3b acceptance pass.*

---

# Phase 7 — Docs + CLAUDE.md

### Task 7.1 — Update root CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Flip the status line**

Change the current Status line (set by Plan 2.2) to include Plan 3a:

```
**Status (as of 2026-04-23):** **Plan 1 + Plan 2 + Plan 2.1 + Plan 2.2 + Plan 3a complete. Dashboard live at https://signage-ouie.vercel.app; first Android TV APK pairs + stores tokens against production Supabase.**
```

- [ ] **Step 2: Add an Android-tooling conventions block**

Append to "Conventions decided during this project":

```
- **Android TV project location: `android-tv/` at the repo root.** Single Gradle module `:app`. Version catalog at `android-tv/gradle/libs.versions.toml` — update versions there, not inline in `build.gradle.kts`.
- **Android prerequisites (one-time, user-installed).** Android Studio 2024.2+ with SDK 34 + Platform-Tools. `ANDROID_HOME=~/Library/Android/sdk`; `adb` must be on PATH. Emulator AVD named `atv34` (Android TV 1080p, API 34 Google TV image). Real-hardware testing goes through `adb connect <tv-ip>:5555` — TV Developer options must have ADB debugging ON.
- **Supabase URL baked at build time.** `app/build.gradle.kts` reads `SUPABASE_URL` from a Gradle property or env var, defaulting to the prod URL. Override with `./gradlew -PSUPABASE_URL=http://10.0.2.2:54321 :app:installDebug` when testing against local supabase (`10.0.2.2` reaches the host loopback from the emulator).
- **Device token storage.** `EncryptedSharedPreferences` in file `signage_tokens.xml`. Excluded from Android auto-backup via `res/xml/backup_rules.xml`. Only the refresh token + device_id survive process death in production; the access token is re-requested on first authed call.
- **401 → refresh → retry.** `TokenAuthenticator` serializes refreshes under a mutex. If refresh itself 401s (or throws), TokenStore is cleared and the app falls back to Pairing on the next AppState emission.
```

- [ ] **Step 3: Add to Key file pointers**

```
- Plan 3a (done): `docs/superpowers/plans/2026-04-22-plan-3a-android-pairing.md`
- Android source: `android-tv/app/src/main/java/com/ouie/signage/`
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): plan 3a shipped — pairing APK lives against prod Supabase"
```

### Task 7.2 — End-of-plan close commit

**Files:** none

- [ ] **Step 1: Empty close commit**

```bash
git commit --allow-empty -m "feat(android): plan 3a — pairing APK mints + stores device tokens end-to-end"
```

---

## Appendix A — Acceptance matrix

| Scenario | Expected behavior |
|---|---|
| First boot, no saved tokens | PairingScreen shows 6-char code + countdown. Polls /pairing-status every 3s. |
| Code claimed from dashboard | Within ≤ 1 poll interval (≤3s), screen flips to "Paired successfully." |
| Code reaches 15-min TTL uncIaimed | `observeClaim` returns `Expired`; UI shows "Code expired — generating a new one…"; new code appears within ~1s. |
| Cold start with saved tokens | MainActivity skips PairingScreen, renders RunningScreen immediately. |
| Network off during polling | `observeClaim` returns `Error`; AppState flips to `Error(NetworkUnavailable)`; auto-retry countdown → recoverToPairing → new code. |
| Dashboard deletes the device (server sets `revoked_at`) | Next refresh 401s → `TokenAuthenticator` clears TokenStore → AppState flips to Pairing (this path isn't exercised in 3a because no authed calls are made — deferred to 3b). |
| `pairing_pickup_consumed` race (two TVs poll the same code) | Only the first TV's poll gets tokens; second TV observes `PickupConsumed`, logs it, and requests a fresh code. |

## Appendix B — Explicit non-goals for 3a (belt-and-braces)

- No heartbeat. Dashboard `/app/screens` will show `last_seen_at = null` for a 3a-paired device. That's fine — heartbeat is Plan 3b Task 1.
- No config sync. The RunningScreen never changes from its placeholder. No HTTP calls fire after pairing succeeds.
- No FCM. `google-services.json` not wired yet (intentional — keeps 3a isolated from Firebase account setup).
- No BOOT_COMPLETED receiver or foreground service. If the TV reboots, the user must tap the Leanback launcher icon. Plan 3c addresses this.
- No USB cache scan. Plan 3b.
- No Media3 playback. Plan 3b.

## Appendix C — Known risks specific to 3a

1. **EncryptedSharedPreferences on API 26–28** can intermittently throw `StrongBoxUnavailableException` on pre-Pie devices. All current F&B TVs are API 29+, so this is theoretical; if encountered, the fallback is `MasterKey.Builder(...).setUserAuthenticationRequired(false)` (already default).
2. **Leanback launcher banner missing on some MIUI forks** — the app may not appear on the home screen even with `LEANBACK_LAUNCHER`. Manual launch via adb is the verification fallback; Plan 3c hardens this.
3. **Retrofit's `Response<T>` vs suspend-return-type ambiguity** — `PairingApi.requestCode` returns `PairingRequestResponse` directly (suspend throws on non-2xx), while `PairingApi.status` returns `Response<...>` so we can inspect status codes without relying on exceptions. Stick to this split; don't change one without the other.
4. **JVM time-zone / Instant parsing on older Android.** `Instant.parse` is API 26+; we target min 26. If min is ever lowered, swap to Desugaring OR a ThreeTenABP shim.
