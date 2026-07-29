package com.jahantrading.app.data.remote.dto

import com.google.gson.annotations.SerializedName

// ── Auth ──

data class LoginRequest(
    val username: String,
    val password: String
)

data class LoginResponse(
    val status: String,
    val user: UserDto?,
    val role_permissions: RolePermissions?,
    val token: String?,
    val message: String?
)

data class UserDto(
    val id: Int,
    val username: String,
    val full_name: String,
    val role: String,
    val client_id: String
)

data class RolePermissions(
    val title: String,
    val allowed_entry_points: List<String>,
    val allowed_report_points: List<String>,
    val can_manage_users: Boolean,
    val can_view_all_clients: Boolean,
    val can_authorize: Boolean?,
    val can_delete: Boolean?
)

data class CreateUserRequest(
    val username: String,
    val password: String,
    val full_name: String,
    val role: String,
    val client_id: String,
    val requested_by: String?
)

data class UserListItem(
    val id: Int,
    val username: String,
    val full_name: String,
    val role: String,
    val client_id: String,
    val is_active: Int
)

// ── Config ──

data class ConfigResponse(
    val system: SystemConfig,
    val database_config: DatabaseConfigPublic,
    val roles: Map<String, RolePermissions>,
    val letterhead: LetterheadConfig,
    val entry_points: List<EntryPointDef>,
    val report_points: List<ReportPointDef>
)

data class SystemConfig(
    val app_name: String,
    val default_client_id: String,
    val currency_symbol: String,
    val chalan_start: Int?,
    val chalan_pad: Int?
)

data class DatabaseConfigPublic(val mode: String)

data class LetterheadConfig(
    val company_name: String?,
    val sub_heading: String?,
    val address: String?,
    val phone: String?,
    val email: String?,
    val website: String?,
    val show_border: Boolean?,
    val header_height_px: Int?,
    val footer_note: String?
)

// ── Config-driven form/report definitions ──

data class EntryPointDef(
    val id: String,
    val title: String,
    val table: String,
    val icon: String?,
    val fields: List<FieldDef>
)

data class FieldDef(
    val name: String,
    val label: String,
    val type: String,
    val required: Boolean?,
    val readonly: Boolean?,
    val options: List<String>?,
    val default: Any?,
    val customer_type_filter: String?,
    val fills_contact_field: String?,
    val depends_on: String?,
    val auto_gen: String?,
    val auto_chalan: Boolean?,
    val readonly_from_product: Boolean?,
    val readonly_from_inventory: Boolean?,
    val show_if: ShowIfCondition?,
    val min: Double?
)

data class ShowIfCondition(
    val field: String,
    val value: String
)

data class ReportPointDef(
    val id: String,
    val title: String,
    val icon: String?,
    val table: String?,
    val columns: List<String>,
    val summary_type: String?,
    val summary_column: String?,
    val supports_period: Boolean?,
    val supports_customer_filter: Boolean?,
    val supports_txn_type_filter: Boolean?
)

// ── Dashboard ──

data class DashboardResponse(
    val total_revenue: Double,
    val total_sales_count: Int,
    val total_purchases: Double,
    val inventory_valuation: Double,
    val low_stock_count: Int,
    val total_receivable: Double,
    val total_payable: Double,
    val recent_sales: List<RecentSale>,
    val currency: String
)

data class RecentSale(
    val id: Int,
    val chalan_no: String,
    val sale_date: String,
    val buyer_name: String,
    val product_type: String,
    val size: String?,
    val sale_total_price: Double,
    val due: Double?
)

// ── Lookups ──

data class ProductDto(
    val id: Int,
    val product_type: String,
    val size: String,
    val unit_price: Double
)

data class InventoryDto(
    val id: Int,
    val product_type: String,
    val size: String,
    val quantity: Double,
    val cost_price: Double
)

data class CustomerDto(
    val id: Int,
    val customer_name: String,
    val customer_type: String,
    val contact_number: String?
)

data class InvoiceRefDto(
    val reference_no: String,
    val quantity: Double?,
    val from_location: String?,
    val to_location: String?
)

// ── Entry ──

data class EntryResponse(
    val status: String,
    val table: String?,
    val id: Int?,
    val chalan_no: String?,
    val input_invoice_no: String?,
    val entry_status: String?,
    val message: String?
)

// ── Reports ──

data class ReportResponse(
    val title: String?,
    val columns: List<String>?,
    val keys: List<String>?,
    val data: List<Map<String, Any?>>?,
    val summary_column: String?,
    val summary_total: Double?,
    val supports_period: Boolean?,
    val supports_customer_filter: Boolean?,
    val status: String?,
    val message: String?
)

// ── Chalan ──

data class ChalanResponse(val chalan_no: String)

// ── Invoice ──

data class InvoiceResponse(
    val sale: Map<String, Any?>?,
    val letterhead: LetterheadConfig?,
    val system: SystemConfig?,
    val status: String?,
    val message: String?
)

// ── Authorization ──

data class PendingResponse(
    val purchases: List<Map<String, Any?>>,
    val sales: List<Map<String, Any?>>
)

data class AuthorizeRequest(
    val authorized_by: String?,
    val client_id: String?
)

data class AdjustRequest(
    val requested_by: String?,
    val client_id: String?,
    val payment_due_date: String?,
    val additional_advance: Double?
)

data class DeleteRequest(
    val requested_by: String?,
    val client_id: String?
)

data class GenericResponse(
    val status: String,
    val message: String?,
    val id: Int?,
    val table: String?
)
