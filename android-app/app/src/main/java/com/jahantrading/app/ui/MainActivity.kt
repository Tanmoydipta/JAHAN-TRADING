package com.jahantrading.app.ui

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.compose.rememberNavController
import com.jahantrading.app.notification.NotificationScheduler
import com.jahantrading.app.ui.navigation.AppNavHost
import com.jahantrading.app.ui.theme.JahanTradingTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        NotificationScheduler.schedule(applicationContext)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            JahanTradingTheme {
                val navController = rememberNavController()
                AppNavHost(navController = navController)
            }
        }
    }
}
