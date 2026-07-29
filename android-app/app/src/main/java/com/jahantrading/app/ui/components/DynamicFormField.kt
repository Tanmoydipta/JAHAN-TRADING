package com.jahantrading.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.jahantrading.app.data.local.entity.CustomerEntity
import com.jahantrading.app.data.local.entity.InventoryEntity
import com.jahantrading.app.data.local.entity.ProductEntity
import com.jahantrading.app.data.remote.dto.FieldDef
import com.jahantrading.app.data.remote.dto.InvoiceRefDto
import com.jahantrading.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DynamicFormField(
    field: FieldDef,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    products: List<ProductEntity> = emptyList(),
    inventory: List<InventoryEntity> = emptyList(),
    customers: List<CustomerEntity> = emptyList(),
    invoiceRefs: List<InvoiceRefDto> = emptyList(),
    onProductSelected: ((ProductEntity) -> Unit)? = null,
    onInventorySelected: ((InventoryEntity) -> Unit)? = null,
    onCustomerSelected: ((CustomerEntity) -> Unit)? = null,
    onInvoiceRefSelected: ((InvoiceRefDto) -> Unit)? = null
) {
    val isReadonly = field.readonly == true
    val label = field.label + if (field.required == true) " *" else ""

    Column(modifier = modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextMuted)
        Spacer(Modifier.height(4.dp))

        when (field.type) {
            "select" -> {
                DropdownField(
                    value = value,
                    options = field.options ?: emptyList(),
                    onSelected = onValueChange
                )
            }

            "product_select" -> {
                DropdownField(
                    value = value,
                    options = products.map { "${it.productType} — ${it.size}" },
                    onSelected = { display ->
                        val product = products.find { "${it.productType} — ${it.size}" == display }
                        if (product != null) {
                            onValueChange(product.productType)
                            onProductSelected?.invoke(product)
                        }
                    }
                )
            }

            "inventory_select" -> {
                val available = inventory.filter { it.quantity > 0 }
                DropdownField(
                    value = value,
                    options = available.map { "${it.productType} — ${it.size} (Stock: ${it.quantity.toInt()})" },
                    onSelected = { display ->
                        val item = available.find { "${it.productType} — ${it.size} (Stock: ${it.quantity.toInt()})" == display }
                        if (item != null) {
                            onValueChange(item.productType)
                            onInventorySelected?.invoke(item)
                        }
                    }
                )
            }

            "customer_select" -> {
                DropdownField(
                    value = value,
                    options = customers.map { c ->
                        if (c.contactNumber.isNullOrBlank()) c.customerName
                        else "${c.customerName} (${c.contactNumber})"
                    },
                    onSelected = { display ->
                        val customer = customers.find { c ->
                            val d = if (c.contactNumber.isNullOrBlank()) c.customerName
                            else "${c.customerName} (${c.contactNumber})"
                            d == display
                        }
                        if (customer != null) {
                            onValueChange(customer.customerName)
                            onCustomerSelected?.invoke(customer)
                        }
                    }
                )
            }

            "invoice_ref_select" -> {
                DropdownField(
                    value = value,
                    options = invoiceRefs.map { it.reference_no },
                    onSelected = { refNo ->
                        onValueChange(refNo)
                        val ref = invoiceRefs.find { it.reference_no == refNo }
                        if (ref != null) onInvoiceRefSelected?.invoke(ref)
                    }
                )
            }

            "date" -> {
                OutlinedTextField(
                    value = value,
                    onValueChange = onValueChange,
                    modifier = Modifier.fillMaxWidth(),
                    readOnly = isReadonly,
                    placeholder = { Text("YYYY-MM-DD", color = TextDim) },
                    singleLine = true,
                    colors = fieldColors()
                )
            }

            "number" -> {
                OutlinedTextField(
                    value = value,
                    onValueChange = { onValueChange(it.filter { c -> c.isDigit() || c == '.' }) },
                    modifier = Modifier.fillMaxWidth(),
                    readOnly = isReadonly,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    colors = fieldColors()
                )
            }

            else -> {
                val isPhoneField = !isReadonly && (
                    field.name.contains("contact", ignoreCase = true) ||
                        field.name.contains("mobile", ignoreCase = true) ||
                        field.name.contains("phone", ignoreCase = true)
                    )

                if (isPhoneField) {
                    val pickContact = rememberContactPicker { _, phone ->
                        if (phone.isNotBlank()) onValueChange(phone)
                    }
                    OutlinedTextField(
                        value = value,
                        onValueChange = onValueChange,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        trailingIcon = {
                            IconButton(onClick = pickContact) {
                                Icon(Icons.Default.Contacts, contentDescription = "Pick from contacts", tint = Primary)
                            }
                        },
                        colors = fieldColors()
                    )
                } else {
                    OutlinedTextField(
                        value = value,
                        onValueChange = onValueChange,
                        modifier = Modifier.fillMaxWidth(),
                        readOnly = isReadonly,
                        singleLine = true,
                        colors = fieldColors()
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DropdownField(
    value: String,
    options: List<String>,
    onSelected: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
            readOnly = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            singleLine = true,
            colors = fieldColors()
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option, style = MaterialTheme.typography.bodyMedium) },
                    onClick = {
                        onSelected(option)
                        expanded = false
                    }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Primary,
    unfocusedBorderColor = BorderColor,
    focusedContainerColor = BgDark,
    unfocusedContainerColor = BgDark,
    cursorColor = Primary,
    focusedTextColor = TextMain,
    unfocusedTextColor = TextMain
)
