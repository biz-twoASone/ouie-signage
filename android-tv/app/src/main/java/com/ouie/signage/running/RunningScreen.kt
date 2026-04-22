package com.ouie.signage.running

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.tv.material3.Text
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
