// android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt
package com.ouie.signage.fcm

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.koin.java.KoinJavaComponent.inject

class SignageMessagingService : FirebaseMessagingService() {

    private val broadcast: SyncNowBroadcast by inject(SyncNowBroadcast::class.java)
    private val tokenSource: FcmTokenSource by inject(FcmTokenSource::class.java)
    private val receiptTracker: FcmReceiptTracker by inject(FcmReceiptTracker::class.java)

    override fun onMessageReceived(message: RemoteMessage) {
        receiptTracker.mark()
        val action = message.data["action"]
        if (action == "sync") broadcast.fire()
    }

    override fun onNewToken(token: String) {
        tokenSource.update(token)
    }
}
