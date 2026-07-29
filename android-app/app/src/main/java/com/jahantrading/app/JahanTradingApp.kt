package com.jahantrading.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.jahantrading.app.notification.NotificationHelper
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class JahanTradingApp : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannel(this)
    }
}
