package com.ouie.signage.fcm

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.koin.java.KoinJavaComponent.inject

/**
 * Receives FCM data messages. The only action we care about in v1 is
 * `action = "sync"` (spec §6.4); everything else is logged and ignored.
 *
 * Service is instantiated by Android (no constructor injection), so we pull
 * Koin singles via `inject`. Plan 3c's coordinator is NOT started from here —
 * the foreground service owns coordinator lifetime. We just poke the sync
 * broadcast; the coordinator will pick it up if it's running.
 */
class SignageMessagingService : FirebaseMessagingService() {

    private val broadcast: SyncNowBroadcast by inject(SyncNowBroadcast::class.java)
    private val tokenSource: FcmTokenSource by inject(FcmTokenSource::class.java)

    override fun onMessageReceived(message: RemoteMessage) {
        val action = message.data["action"]
        if (action == "sync") broadcast.fire()
    }

    override fun onNewToken(token: String) {
        tokenSource.update(token)
    }
}
