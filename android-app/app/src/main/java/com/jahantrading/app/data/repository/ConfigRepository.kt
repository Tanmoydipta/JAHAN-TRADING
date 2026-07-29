package com.jahantrading.app.data.repository

import com.jahantrading.app.data.local.SessionStore
import com.jahantrading.app.data.remote.ApiService
import com.jahantrading.app.data.remote.dto.ConfigResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ConfigRepository @Inject constructor(
    private val api: ApiService,
    private val session: SessionStore
) {
    val cachedConfig: Flow<ConfigResponse?> = session.cachedConfig

    suspend fun getConfig(forceRefresh: Boolean = false): Result<ConfigResponse> {
        if (!forceRefresh) {
            val cached = session.cachedConfig.first()
            if (cached != null) return Result.success(cached)
        }

        return try {
            val response = api.getConfig()
            if (response.isSuccessful) {
                val config = response.body()!!
                session.cacheConfig(config)
                Result.success(config)
            } else {
                val cached = session.cachedConfig.first()
                if (cached != null) Result.success(cached)
                else Result.failure(Exception("Failed to load config: ${response.code()}"))
            }
        } catch (e: Exception) {
            val cached = session.cachedConfig.first()
            if (cached != null) Result.success(cached)
            else Result.failure(e)
        }
    }
}
