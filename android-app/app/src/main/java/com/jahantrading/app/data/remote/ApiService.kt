package com.jahantrading.app.data.remote

import com.jahantrading.app.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // ── Config ──
    @GET("api/config")
    suspend fun getConfig(): Response<ConfigResponse>

    // ── Auth ──
    @POST("api/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/logout")
    suspend fun logout(): Response<GenericResponse>

    // ── Users ──
    @GET("api/users")
    suspend fun getUsers(@Query("requested_by") requestedBy: String): Response<List<UserListItem>>

    @POST("api/users")
    suspend fun createUser(@Body request: CreateUserRequest): Response<GenericResponse>

    @HTTP(method = "DELETE", path = "api/users/{userId}", hasBody = true)
    suspend fun deleteUser(
        @Path("userId") userId: Int,
        @Body request: DeleteRequest
    ): Response<GenericResponse>

    // ── Dashboard ──
    @GET("api/dashboard")
    suspend fun getDashboard(@Query("client_id") clientId: String): Response<DashboardResponse>

    // ── Chalan ──
    @GET("api/next_chalan")
    suspend fun getNextChalan(@Query("client_id") clientId: String): Response<ChalanResponse>

    // ── Lookups ──
    @GET("api/products")
    suspend fun getProducts(@Query("client_id") clientId: String): Response<List<ProductDto>>

    @GET("api/inventory")
    suspend fun getInventory(@Query("client_id") clientId: String): Response<List<InventoryDto>>

    @GET("api/customers")
    suspend fun getCustomers(
        @Query("client_id") clientId: String,
        @Query("type") type: String? = null
    ): Response<List<CustomerDto>>

    @GET("api/invoice_refs")
    suspend fun getInvoiceRefs(
        @Query("client_id") clientId: String,
        @Query("type") type: String
    ): Response<List<InvoiceRefDto>>

    // ── Entry (generic save) ──
    @POST("api/entry/{entryId}")
    suspend fun saveEntry(
        @Path("entryId") entryId: String,
        @Body data: Map<String, @JvmSuppressWildcards Any?>
    ): Response<EntryResponse>

    // ── Reports ──
    @GET("api/report/{reportId}")
    suspend fun getReport(
        @Path("reportId") reportId: String,
        @Query("client_id") clientId: String,
        @Query("from") dateFrom: String? = null,
        @Query("to") dateTo: String? = null,
        @Query("customer") customer: String? = null,
        @Query("txn_type") txnType: String? = null
    ): Response<ReportResponse>

    // ── Invoice ──
    @GET("api/invoice/{invoiceId}")
    suspend fun getInvoice(
        @Path("invoiceId") invoiceId: String,
        @Query("client_id") clientId: String
    ): Response<InvoiceResponse>

    // ── Authorization ──
    @GET("api/pending")
    suspend fun getPending(@Query("client_id") clientId: String): Response<PendingResponse>

    @POST("api/authorize/{tableName}/{recordId}")
    suspend fun authorize(
        @Path("tableName") tableName: String,
        @Path("recordId") recordId: Int,
        @Body request: AuthorizeRequest
    ): Response<GenericResponse>

    // ── Record operations ──
    @HTTP(method = "DELETE", path = "api/record/{tableName}/{recordId}", hasBody = true)
    suspend fun deleteRecord(
        @Path("tableName") tableName: String,
        @Path("recordId") recordId: Int,
        @Body request: DeleteRequest
    ): Response<GenericResponse>

    @POST("api/record/{tableName}/{recordId}/adjust")
    suspend fun adjustRecord(
        @Path("tableName") tableName: String,
        @Path("recordId") recordId: Int,
        @Body request: AdjustRequest
    ): Response<GenericResponse>

    // ── Letterhead ──
    @POST("api/letterhead")
    suspend fun updateLetterhead(@Body letterhead: Map<String, @JvmSuppressWildcards Any?>): Response<GenericResponse>
}
