package com.jahantrading.app.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jahantrading.app.data.local.SessionStore
import com.jahantrading.app.data.repository.AuthRepository
import com.jahantrading.app.data.repository.ConfigRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val clientId: String = "CLI-001",
    val apiUrl: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val isLoggedIn: Boolean = false,
    val showApiConfig: Boolean = false
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepo: AuthRepository,
    private val configRepo: ConfigRepository,
    private val sessionStore: SessionStore
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            sessionStore.apiBaseUrl.collect { url ->
                _state.value = _state.value.copy(apiUrl = url, showApiConfig = url.isBlank())
            }
        }
    }

    fun updateUsername(v: String) { _state.value = _state.value.copy(username = v) }
    fun updatePassword(v: String) { _state.value = _state.value.copy(password = v) }
    fun updateClientId(v: String) { _state.value = _state.value.copy(clientId = v) }
    fun updateApiUrl(v: String) { _state.value = _state.value.copy(apiUrl = v) }
    fun toggleApiConfig() { _state.value = _state.value.copy(showApiConfig = !_state.value.showApiConfig) }

    fun login() {
        val s = _state.value
        if (s.username.isBlank() || s.password.isBlank()) {
            _state.value = s.copy(error = "Username and password required")
            return
        }

        viewModelScope.launch {
            _state.value = s.copy(isLoading = true, error = null)

            if (s.apiUrl.isNotBlank()) {
                sessionStore.saveApiBaseUrl(s.apiUrl.trimEnd('/') + "/")
            }

            val result = authRepo.login(s.username, s.password, s.clientId)
            result.fold(
                onSuccess = { response ->
                    if (response.status == "success") {
                        configRepo.getConfig(forceRefresh = true)
                        _state.value = _state.value.copy(isLoading = false, isLoggedIn = true)
                    } else {
                        _state.value = _state.value.copy(
                            isLoading = false,
                            error = response.message ?: "Login failed"
                        )
                    }
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = "Connection error: ${e.message}"
                    )
                }
            )
        }
    }
}
