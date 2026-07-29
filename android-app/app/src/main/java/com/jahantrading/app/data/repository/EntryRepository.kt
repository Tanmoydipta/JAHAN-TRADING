package com.jahantrading.app.data.repository

import com.google.gson.Gson
import com.jahantrading.app.data.local.AppDatabase
import com.jahantrading.app.data.local.entity.PendingEntryEntity
import com.jahantrading.app.data.remote.ApiService
import com.jahantrading.app.data.remote.dto.ChalanResponse
import com.jahantrading.app.data.remote.dto.EntryResponse
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EntryRepository @Inject constructor(
    private val api: ApiService,
    private val db: AppDatabase
) {
    private val gson = Gson()

    suspend fun saveEntry(
        entryId: String,
        clientId: String,
        data: Map<String, Any?>
    ): Result<EntryResponse> {
        return try {
            val response = api.saveEntry(entryId, data)
            if (response.isSuccessful) {
                Result.success(response.body()!!)
            } else {
                val errorBody = response.errorBody()?.string()
                Result.failure(Exception(errorBody ?: "Save failed: ${response.code()}"))
            }
        } catch (e: Exception) {
            // Queue for later sync if offline
            db.pendingEntryDao().insert(
                PendingEntryEntity(
                    entryId = entryId,
                    clientId = clientId,
                    jsonPayload = gson.toJson(data)
                )
            )
            Result.failure(OfflineQueuedException("Saved locally, will sync when online"))
        }
    }

    suspend fun getNextChalan(clientId: String): Result<String> {
        return try {
            val response = api.getNextChalan(clientId)
            if (response.isSuccessful) Result.success(response.body()!!.chalan_no)
            else Result.failure(Exception("Failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun syncPendingEntries(): Int {
        val pending = db.pendingEntryDao().getUnsynced()
        var synced = 0
        for (entry in pending) {
            try {
                @Suppress("UNCHECKED_CAST")
                val data = gson.fromJson(entry.jsonPayload, Map::class.java) as Map<String, Any?>
                val response = api.saveEntry(entry.entryId, data)
                if (response.isSuccessful) {
                    db.pendingEntryDao().markSynced(entry.localId)
                    synced++
                }
            } catch (_: Exception) {
                break // stop on first failure — likely still offline
            }
        }
        if (synced > 0) db.pendingEntryDao().clearSynced()
        return synced
    }
}

class OfflineQueuedException(message: String) : Exception(message)
