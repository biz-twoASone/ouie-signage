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
