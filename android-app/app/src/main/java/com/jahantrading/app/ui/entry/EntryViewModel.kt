package com.jahantrading.app.ui.entry

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jahantrading.app.data.local.entity.CustomerEntity
import com.jahantrading.app.data.local.entity.InventoryEntity
import com.jahantrading.app.data.local.entity.ProductEntity
import com.jahantrading.app.data.remote.dto.EntryPointDef
import com.jahantrading.app.data.remote.dto.InvoiceRefDto
import com.jahantrading.app.data.repository.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

data class EntryUiState(
    val entryDef: EntryPointDef? = null,
    val fieldValues: Map<String, String> = emptyMap(),
    val products: List<ProductEntity> = emptyList(),
    val inventory: List<InventoryEntity> = emptyList(),
    val customers: Map<String, List<CustomerEntity>> = emptyMap(),
    val invoiceRefs: List<InvoiceRefDto> = emptyList(),
    val calculatedTotal: Double = 0.0,
    val calculatedDue: Double = 0.0,
    val isSubmitting: Boolean = false,
    val successMessage: String? = null,
    val error: String? = null
)

@HiltViewModel
class EntryViewModel @Inject constructor(
    private val configRepo: ConfigRepository,
    private val entryRepo: EntryRepository,
    private val lookupRepo: LookupRepository,
    private val authRepo: AuthRepository
) : ViewModel() {

    private val _state = MutableStateFlow(EntryUiState())
    val state: StateFlow<EntryUiState> = _state.asStateFlow()

    private var clientId = "CLI-001"
    private var username: String? = null

    fun loadEntry(entryId: String) {
        viewModelScope.launch {
            clientId = authRepo.clientId.first()
            username = authRepo.currentUser.first()?.username

            val config = configRepo.getConfig().getOrNull() ?: return@launch
            val entryDef = config.entry_points.find { it.id == entryId } ?: return@launch

            // Set defaults
            val defaults = mutableMapOf<String, String>()
            entryDef.fields.forEach { f ->
                when {
                    f.type == "date" -> defaults[f.name] = LocalDate.now().toString()
                    f.auto_gen != null -> defaults[f.name] = "${f.auto_gen}${System.currentTimeMillis().toString().takeLast(6)}"
                    f.default != null -> defaults[f.name] = f.default.toString()
                    else -> defaults[f.name] = ""
                }
            }

            // Auto chalan
            if (entryDef.table == "sales") {
                entryRepo.getNextChalan(clientId).onSuccess { defaults["chalan_no"] = it }
            }

            _state.value = _state.value.copy(entryDef = entryDef, fieldValues = defaults)

            // Load lookups
            loadLookups(entryDef)
        }
    }

    private suspend fun loadLookups(entryDef: EntryPointDef) {
        val products = lookupRepo.observeProducts(clientId).first()
        val inventory = lookupRepo.observeInventory(clientId).first()

        val customerTypes = entryDef.fields
            .filter { it.type == "customer_select" }
            .mapNotNull { it.customer_type_filter }
            .distinct()

        val customersByType = mutableMapOf<String, List<CustomerEntity>>()
        customerTypes.forEach { type ->
            customersByType[type] = lookupRepo.getCustomersByType(clientId, type)
        }

        _state.value = _state.value.copy(
            products = products,
            inventory = inventory,
            customers = customersByType
        )
    }

    fun updateField(name: String, value: String) {
        val updated = _state.value.fieldValues.toMutableMap().apply { this[name] = value }
        _state.value = _state.value.copy(fieldValues = updated)
        recalculate()
    }

    fun onProductSelected(product: ProductEntity) {
        val updated = _state.value.fieldValues.toMutableMap()
        updated["size"] = product.size
        updated["unit_price"] = product.unitPrice.toString()
        _state.value = _state.value.copy(fieldValues = updated)
        recalculate()
    }

    fun onInventorySelected(item: InventoryEntity) {
        val updated = _state.value.fieldValues.toMutableMap()
        updated["size"] = item.size
        updated["cost_price"] = item.costPrice.toString()
        _state.value = _state.value.copy(fieldValues = updated)
        recalculate()
    }

    fun onCustomerSelected(customer: CustomerEntity, fillsField: String?) {
        if (fillsField != null) {
            val updated = _state.value.fieldValues.toMutableMap()
            updated[fillsField] = customer.contactNumber ?: ""
            _state.value = _state.value.copy(fieldValues = updated)
        }
    }

    fun onInvoiceRefSelected(ref: InvoiceRefDto) {
        val updated = _state.value.fieldValues.toMutableMap()
        updated["quantity"] = (ref.quantity ?: 0.0).toString()
        updated["from_location"] = ref.from_location ?: ""
        updated["to_location"] = ref.to_location ?: ""
        _state.value = _state.value.copy(fieldValues = updated)
    }

    fun loadInvoiceRefs(movementType: String) {
        viewModelScope.launch {
            val refType = if (movementType == "Sales") "sales" else "purchases"
            lookupRepo.getInvoiceRefs(clientId, refType).onSuccess { refs ->
                _state.value = _state.value.copy(invoiceRefs = refs)
            }
        }
    }

    private fun recalculate() {
        val v = _state.value.fieldValues
        val table = _state.value.entryDef?.table ?: return

        val (total, due) = when (table) {
            "sales" -> {
                val t = (v["received_quantity"]?.toDoubleOrNull() ?: 0.0) * (v["sale_unit_price"]?.toDoubleOrNull() ?: 0.0)
                t to maxOf(0.0, t - (v["advance"]?.toDoubleOrNull() ?: 0.0))
            }
            "purchases" -> {
                val t = (v["quantity"]?.toDoubleOrNull() ?: 0.0) * (v["unit_price"]?.toDoubleOrNull() ?: 0.0)
                t to maxOf(0.0, t - (v["advance"]?.toDoubleOrNull() ?: 0.0))
            }
            "transporters" -> {
                val rent = v["rent"]?.toDoubleOrNull() ?: 0.0
                rent to maxOf(0.0, rent - (v["advance"]?.toDoubleOrNull() ?: 0.0))
            }
            else -> 0.0 to 0.0
        }

        _state.value = _state.value.copy(calculatedTotal = total, calculatedDue = due)
    }

    fun submit() {
        val entryDef = _state.value.entryDef ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(isSubmitting = true, error = null, successMessage = null)

            val payload = _state.value.fieldValues.toMutableMap<String, Any?>()
            payload["client_id"] = clientId
            payload["created_by"] = username

            entryRepo.saveEntry(entryDef.id, clientId, payload).fold(
                onSuccess = { response ->
                    val msg = when {
                        response.chalan_no != null -> "Sale saved (Chalan #${response.chalan_no})"
                        response.input_invoice_no != null -> "Purchase saved (Invoice #${response.input_invoice_no})"
                        else -> "Record saved to ${response.table}"
                    }
                    _state.value = _state.value.copy(isSubmitting = false, successMessage = msg)
                    lookupRepo.refreshAll(clientId)
                },
                onFailure = { e ->
                    val isQueued = e is OfflineQueuedException
                    _state.value = _state.value.copy(
                        isSubmitting = false,
                        error = if (!isQueued) e.message else null,
                        successMessage = if (isQueued) "Saved offline — will sync when connected" else null
                    )
                }
            )
        }
    }

    fun resetForm() {
        _state.value.entryDef?.let { loadEntry(it.id) }
    }
}
