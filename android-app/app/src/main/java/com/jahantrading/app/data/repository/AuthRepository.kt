package com.jahantrading.app.data.repository

import com.jahantrading.app.data.local.SessionStore
import com.jahantrading.app.data.remote.ApiService
import com.jahantrading.app.data.remote.dto.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: ApiService,
    private val session: SessionStore
) {
    val currentUser: Flow<UserDto?> = session.currentUser
    val permissions: Flow<RolePermissions?> = session.permissions
    val clientId: Flow<String> = session.clientId

    suspend fun login(username: String, password: String, clientId: String): Result<LoginResponse> {
        return try {
            val response = api.login(LoginRequest(username, password))
            if (response.isSuccessful) {
                val body = response.body()!!
                if (body.status == "success" && body.user != null && body.role_permissions != null && body.token != null) {
                    session.saveSession(body.user, body.role_permissions, clientId, body.token)
                }
                Result.success(body)
            } else {
                Result.failure(Exception("Login failed: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun logout() {
        try {
            api.logout()
        } catch (e: Exception) {
            // Best-effort server-side revoke; local session clears regardless.
        }
        session.clearSession()
    }

    suspend fun switchClient(clientId: String) {
        session.updateClientId(clientId)
    }

    suspend fun isLoggedIn(): Boolean {
        return session.currentUser.first() != null
    }
}
