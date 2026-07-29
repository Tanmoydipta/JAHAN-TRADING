package com.jahantrading.app.data.repository

import com.jahantrading.app.data.local.AppDatabase
import com.jahantrading.app.data.local.entity.CustomerEntity
import com.jahantrading.app.data.local.entity.InventoryEntity
import com.jahantrading.app.data.local.entity.ProductEntity
import com.jahantrading.app.data.remote.ApiService
import com.jahantrading.app.data.remote.dto.InvoiceRefDto
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LookupRepository @Inject constructor(
    private val api: ApiService,
    private val db: AppDatabase
) {
    // ── Products: cache-first, background refresh ──

    fun observeProducts(clientId: String): Flow<List<ProductEntity>> =
        db.productDao().observeByClient(clientId)

    suspend fun refreshProducts(clientId: String) {
        val response = api.getProducts(clientId)
        if (response.isSuccessful) {
            val entities = response.body()!!.map {
                ProductEntity(it.id, clientId, it.product_type, it.size, it.unit_price)
            }
            db.productDao().replaceForClient(clientId, entities)
        }
    }

    // ── Customers: cache-first, background refresh ──

    fun observeCustomers(clientId: String, type: String): Flow<List<CustomerEntity>> =
        db.customerDao().observeByType(clientId, type)

    suspend fun refreshCustomers(clientId: String) {
        val response = api.getCustomers(clientId)
        if (response.isSuccessful) {
            val entities = response.body()!!.map {
                CustomerEntity(it.id, clientId, it.customer_name, it.customer_type, it.contact_number)
            }
            db.customerDao().replaceForClient(clientId, entities)
        }
    }

    suspend fun getCustomersByType(clientId: String, type: String): List<CustomerEntity> {
        val cached = db.customerDao().getByType(clientId, type)
        if (cached.isNotEmpty()) return cached
        refreshCustomers(clientId)
        return db.customerDao().getByType(clientId, type)
    }

    // ── Inventory: cache-first, background refresh ──

    fun observeInventory(clientId: String): Flow<List<InventoryEntity>> =
        db.inventoryDao().observeByClient(clientId)

    suspend fun refreshInventory(clientId: String) {
        val response = api.getInventory(clientId)
        if (response.isSuccessful) {
            val entities = response.body()!!.map {
                InventoryEntity(it.id, clientId, it.product_type, it.size, it.quantity, it.cost_price)
            }
            db.inventoryDao().replaceForClient(clientId, entities)
        }
    }

    // ── Invoice refs (not cached — always fresh) ──

    suspend fun getInvoiceRefs(clientId: String, type: String): Result<List<InvoiceRefDto>> {
        return try {
            val response = api.getInvoiceRefs(clientId, type)
            if (response.isSuccessful) Result.success(response.body()!!)
            else Result.failure(Exception("Failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Bulk refresh all lookups ──

    suspend fun refreshAll(clientId: String) {
        refreshProducts(clientId)
        refreshCustomers(clientId)
        refreshInventory(clientId)
    }
}
