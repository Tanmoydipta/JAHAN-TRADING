package com.jahantrading.app.notification

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.jahantrading.app.data.local.SessionStore
import com.jahantrading.app.data.remote.ApiService
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first

/**
 * Periodic check for outstanding receivables, low stock, and pending
 * authorizations — surfaced as local notifications. Runs only while a
 * session is active; skips silently otherwise.
 */
@HiltWorker
class DueAlertWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val api: ApiService,
    private val session: SessionStore
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val user = session.currentUser.first() ?: return Result.success()
        val clientId = session.clientId.first()

        return try {
            val dashboard = api.getDashboard(clientId)
            if (dashboard.isSuccessful) {
                val body = dashboard.body()!!
                if (body.total_receivable > 0) {
                    NotificationHelper.show(
                        applicationContext,
                        NotificationHelper.ID_RECEIVABLES,
                        "Outstanding receivables",
                        "${body.currency} ${"%.2f".format(body.total_receivable)} due from customers"
                    )
                }
                if (body.low_stock_count > 0) {
                    NotificationHelper.show(
                        applicationContext,
                        NotificationHelper.ID_LOW_STOCK,
                        "Low stock alert",
                        "${body.low_stock_count} product(s) running low on inventory"
                    )
                }
            }

            if (user.role == "admin") {
                val pending = api.getPending(clientId)
                if (pending.isSuccessful) {
                    val body = pending.body()!!
                    val count = body.purchases.size + body.sales.size
                    if (count > 0) {
                        NotificationHelper.show(
                            applicationContext,
                            NotificationHelper.ID_PENDING_AUTH,
                            "Pending authorization",
                            "$count transaction(s) awaiting your authorization"
                        )
                    }
                }
            }

            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
