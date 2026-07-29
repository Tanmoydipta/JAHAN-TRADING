package com.jahantrading.app.data.repository

import com.google.gson.Gson
import com.jahantrading.app.data.local.AppDatabase
import com.jahantrading.app.data.local.entity.DashboardCacheEntity
import com.jahantrading.app.data.remote.ApiService
import com.jahantrading.app.data.remote.dto.DashboardResponse
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DashboardRepository @Inject constructor(
    private val api: ApiService,
    private val db: AppDatabase
) {
    private val gson = Gson()
    private val staleness = 30_000L // 30s — show cached, refresh behind

    suspend fun getDashboard(clientId: String, forceRefresh: Boolean = false): Result<DashboardResponse> {
        // 1. Return cache immediately if fresh enough
        if (!forceRefresh) {
            val cached = db.dashboardCacheDao().get(clientId)
            if (cached != null && System.currentTimeMillis() - cached.cachedAt < staleness) {
                return Result.success(gson.fromJson(cached.jsonData, DashboardResponse::class.java))
            }
        }

        // 2. Fetch from API
        return try {
            val response = api.getDashboard(clientId)
            if (response.isSuccessful) {
                val body = response.body()!!
                db.dashboardCacheDao().upsert(
                    DashboardCacheEntity(clientId, gson.toJson(body))
                )
                Result.success(body)
            } else {
                // Fall back to stale cache on API error
                val stale = db.dashboardCacheDao().get(clientId)
                if (stale != null) {
                    Result.success(gson.fromJson(stale.jsonData, DashboardResponse::class.java))
                } else {
                    Result.failure(Exception("API error ${response.code()} and no cache"))
                }
            }
        } catch (e: Exception) {
            val stale = db.dashboardCacheDao().get(clientId)
            if (stale != null) {
                Result.success(gson.fromJson(stale.jsonData, DashboardResponse::class.java))
            } else {
                Result.failure(e)
            }
        }
    }
}
