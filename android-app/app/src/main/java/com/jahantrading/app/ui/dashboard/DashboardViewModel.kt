package com.jahantrading.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jahantrading.app.data.remote.dto.*
import com.jahantrading.app.data.repository.AuthRepository
import com.jahantrading.app.data.repository.ConfigRepository
import com.jahantrading.app.data.repository.DashboardRepository
import com.jahantrading.app.data.repository.LookupRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardUiState(
    val dashboard: DashboardResponse? = null,
    val config: ConfigResponse? = null,
    val user: UserDto? = null,
    val permissions: RolePermissions? = null,
    val clientId: String = "CLI-001",
    val isLoading: Boolean = true,
    val error: String? = null
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val dashboardRepo: DashboardRepository,
    private val configRepo: ConfigRepository,
    private val authRepo: AuthRepository,
    private val lookupRepo: LookupRepository
) : ViewModel() {

    private val _state = MutableStateFlow(DashboardUiState())
    val state: StateFlow<DashboardUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            combine(authRepo.currentUser, authRepo.permissions, authRepo.clientId) { user, perms, clientId ->
                Triple(user, perms, clientId)
            }.collect { (user, perms, clientId) ->
                _state.value = _state.value.copy(user = user, permissions = perms, clientId = clientId)
                loadDashboard(clientId)
            }
        }

        viewModelScope.launch {
            configRepo.cachedConfig.collect { config ->
                if (config != null) _state.value = _state.value.copy(config = config)
            }
        }
    }

    fun refresh() {
        viewModelScope.launch { loadDashboard(_state.value.clientId, force = true) }
    }

    private suspend fun loadDashboard(clientId: String, force: Boolean = false) {
        _state.value = _state.value.copy(isLoading = true, error = null)

        // Parallel: dashboard + lookups + config
        val dashResult = dashboardRepo.getDashboard(clientId, forceRefresh = force)
        viewModelScope.launch { lookupRepo.refreshAll(clientId) }
        viewModelScope.launch { configRepo.getConfig() }

        dashResult.fold(
            onSuccess = { _state.value = _state.value.copy(dashboard = it, isLoading = false) },
            onFailure = { _state.value = _state.value.copy(error = it.message, isLoading = false) }
        )
    }

    fun logout() {
        viewModelScope.launch { authRepo.logout() }
    }
}
