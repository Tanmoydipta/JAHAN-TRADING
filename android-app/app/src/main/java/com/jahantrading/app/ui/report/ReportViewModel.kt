package com.jahantrading.app.ui.report

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jahantrading.app.data.remote.dto.ReportPointDef
import com.jahantrading.app.data.repository.AuthRepository
import com.jahantrading.app.data.repository.ConfigRepository
import com.jahantrading.app.data.repository.ReportRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ReportUiState(
    val reportDef: ReportPointDef? = null,
    val columns: List<String> = emptyList(),
    val keys: List<String> = emptyList(),
    val rows: List<Map<String, Any?>> = emptyList(),
    val summaryColumn: String? = null,
    val summaryTotal: Double = 0.0,
    val dateFrom: String = "",
    val dateTo: String = "",
    val customerFilter: String = "",
    val txnType: String = "All",
    val searchQuery: String = "",
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class ReportViewModel @Inject constructor(
    private val reportRepo: ReportRepository,
    private val configRepo: ConfigRepository,
    private val authRepo: AuthRepository
) : ViewModel() {

    private val _state = MutableStateFlow(ReportUiState())
    val state: StateFlow<ReportUiState> = _state.asStateFlow()

    private var clientId = "CLI-001"

    fun loadReport(reportId: String) {
        viewModelScope.launch {
            clientId = authRepo.clientId.first()

            val config = configRepo.getConfig().getOrNull() ?: return@launch
            val reportDef = config.report_points.find { it.id == reportId } ?: return@launch
            _state.value = _state.value.copy(reportDef = reportDef)

            fetchData(reportId)
        }
    }

    fun updateDateFrom(v: String) { _state.value = _state.value.copy(dateFrom = v) }
    fun updateDateTo(v: String) { _state.value = _state.value.copy(dateTo = v) }
    fun updateCustomerFilter(v: String) { _state.value = _state.value.copy(customerFilter = v) }
    fun updateTxnType(v: String) { _state.value = _state.value.copy(txnType = v) }
    fun updateSearch(v: String) { _state.value = _state.value.copy(searchQuery = v) }

    fun applyFilters() {
        val reportId = _state.value.reportDef?.id ?: return
        viewModelScope.launch { fetchData(reportId) }
    }

    fun clearFilters() {
        _state.value = _state.value.copy(dateFrom = "", dateTo = "", customerFilter = "", txnType = "All", searchQuery = "")
        applyFilters()
    }

    private suspend fun fetchData(reportId: String) {
        val s = _state.value
        _state.value = s.copy(isLoading = true, error = null)

        val result = reportRepo.getReport(
            reportId, clientId,
            dateFrom = s.dateFrom.ifBlank { null },
            dateTo = s.dateTo.ifBlank { null },
            customer = s.customerFilter.ifBlank { null },
            txnType = if (s.txnType == "All") null else s.txnType
        )

        result.fold(
            onSuccess = { data ->
                _state.value = _state.value.copy(
                    columns = data.columns ?: emptyList(),
                    keys = data.keys ?: emptyList(),
                    rows = data.data ?: emptyList(),
                    summaryColumn = data.summary_column,
                    summaryTotal = data.summary_total ?: 0.0,
                    isLoading = false
                )
            },
            onFailure = { e ->
                _state.value = _state.value.copy(isLoading = false, error = e.message)
            }
        )
    }

    val filteredRows: List<Map<String, Any?>>
        get() {
            val query = _state.value.searchQuery.lowercase()
            if (query.isBlank()) return _state.value.rows
            return _state.value.rows.filter { row ->
                row.values.any { it?.toString()?.lowercase()?.contains(query) == true }
            }
        }
}
