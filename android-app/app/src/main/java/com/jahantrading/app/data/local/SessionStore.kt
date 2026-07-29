package com.jahantrading.app.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.gson.Gson
import com.jahantrading.app.data.remote.dto.ConfigResponse
import com.jahantrading.app.data.remote.dto.RolePermissions
import com.jahantrading.app.data.remote.dto.UserDto
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "jahan_session")

@Singleton
class SessionStore @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val gson = Gson()

    private object Keys {
        val USER = stringPreferencesKey("user")
        val PERMISSIONS = stringPreferencesKey("permissions")
        val CLIENT_ID = stringPreferencesKey("client_id")
        val API_BASE_URL = stringPreferencesKey("api_base_url")
        val CONFIG_CACHE = stringPreferencesKey("config_cache")
        val AUTH_TOKEN = stringPreferencesKey("auth_token")
    }

    val currentUser: Flow<UserDto?> = context.dataStore.data.map { prefs ->
        prefs[Keys.USER]?.let { gson.fromJson(it, UserDto::class.java) }
    }

    val authToken: Flow<String?> = context.dataStore.data.map { prefs -> prefs[Keys.AUTH_TOKEN] }

    val permissions: Flow<RolePermissions?> = context.dataStore.data.map { prefs ->
        prefs[Keys.PERMISSIONS]?.let { gson.fromJson(it, RolePermissions::class.java) }
    }

    val clientId: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[Keys.CLIENT_ID] ?: "CLI-001"
    }

    val apiBaseUrl: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[Keys.API_BASE_URL] ?: ""
    }

    val cachedConfig: Flow<ConfigResponse?> = context.dataStore.data.map { prefs ->
        prefs[Keys.CONFIG_CACHE]?.let { gson.fromJson(it, ConfigResponse::class.java) }
    }

    suspend fun saveSession(user: UserDto, permissions: RolePermissions, clientId: String, token: String) {
        context.dataStore.edit { prefs ->
            prefs[Keys.USER] = gson.toJson(user)
            prefs[Keys.PERMISSIONS] = gson.toJson(permissions)
            prefs[Keys.CLIENT_ID] = clientId
            prefs[Keys.AUTH_TOKEN] = token
        }
    }

    suspend fun updateClientId(clientId: String) {
        context.dataStore.edit { it[Keys.CLIENT_ID] = clientId }
    }

    suspend fun saveApiBaseUrl(url: String) {
        context.dataStore.edit { it[Keys.API_BASE_URL] = url }
    }

    suspend fun cacheConfig(config: ConfigResponse) {
        context.dataStore.edit { it[Keys.CONFIG_CACHE] = gson.toJson(config) }
    }

    suspend fun clearSession() {
        context.dataStore.edit { prefs ->
            prefs.remove(Keys.USER)
            prefs.remove(Keys.PERMISSIONS)
            prefs.remove(Keys.AUTH_TOKEN)
        }
    }
}
