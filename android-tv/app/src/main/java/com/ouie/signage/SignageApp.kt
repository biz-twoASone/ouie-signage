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
