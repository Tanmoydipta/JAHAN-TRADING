package com.jahantrading.app.data.repository

import com.jahantrading.app.data.remote.ApiService
import com.jahantrading.app.data.remote.dto.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ReportRepository @Inject constructor(
    private val api: ApiService
) {
    suspend fun getReport(
        reportId: String,
        clientId: String,
        dateFrom: String? = null,
        dateTo: String? = null,
        customer: String? = null,
        txnType: String? = null
    ): Result<ReportResponse> {
        return try {
            val response = api.getReport(reportId, clientId, dateFrom, dateTo, customer, txnType)
            if (response.isSuccessful) {
                val body = response.body()!!
                if (body.status == "error") Result.failure(Exception(body.message))
                else Result.success(body)
            } else {
                Result.failure(Exception("Report error: ${response.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getPending(clientId: String): Result<PendingResponse> {
        return try {
            val response = api.getPending(clientId)
            if (response.isSuccessful) Result.success(response.body()!!)
            else Result.failure(Exception("Failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun authorize(
        tableName: String,
        recordId: Int,
        authorizedBy: String?,
        clientId: String?
    ): Result<GenericResponse> {
        return try {
            val response = api.authorize(tableName, recordId, AuthorizeRequest(authorizedBy, clientId))
            if (response.isSuccessful) Result.success(response.body()!!)
            else Result.failure(Exception("Authorization failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteRecord(
        tableName: String,
        recordId: Int,
        requestedBy: String?,
        clientId: String?
    ): Result<GenericResponse> {
        return try {
            val response = api.deleteRecord(tableName, recordId, DeleteRequest(requestedBy, clientId))
            if (response.isSuccessful) Result.success(response.body()!!)
            else Result.failure(Exception("Delete failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun adjustRecord(
        tableName: String,
        recordId: Int,
        requestedBy: String?,
        clientId: String?,
        paymentDueDate: String?,
        additionalAdvance: Double?
    ): Result<GenericResponse> {
        return try {
            val response = api.adjustRecord(
                tableName, recordId,
                AdjustRequest(requestedBy, clientId, paymentDueDate, additionalAdvance)
            )
            if (response.isSuccessful) Result.success(response.body()!!)
            else Result.failure(Exception("Adjust failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getInvoice(invoiceId: String, clientId: String): Result<InvoiceResponse> {
        return try {
            val response = api.getInvoice(invoiceId, clientId)
            if (response.isSuccessful) Result.success(response.body()!!)
            else Result.failure(Exception("Invoice not found"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
