package com.jahantrading.app.data.local.dao

import androidx.room.*
import com.jahantrading.app.data.local.entity.*
import kotlinx.coroutines.flow.Flow

@Dao
interface ProductDao {
    @Query("SELECT * FROM products WHERE clientId = :clientId ORDER BY productType, size")
    fun observeByClient(clientId: String): Flow<List<ProductEntity>>

    @Query("SELECT * FROM products WHERE clientId = :clientId ORDER BY productType, size")
    suspend fun getByClient(clientId: String): List<ProductEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(products: List<ProductEntity>)

    @Query("DELETE FROM products WHERE clientId = :clientId")
    suspend fun deleteByClient(clientId: String)

    @Transaction
    suspend fun replaceForClient(clientId: String, products: List<ProductEntity>) {
        deleteByClient(clientId)
        upsertAll(products)
    }
}

@Dao
interface CustomerDao {
    @Query("SELECT * FROM customers WHERE clientId = :clientId AND customerType = :type ORDER BY customerName")
    fun observeByType(clientId: String, type: String): Flow<List<CustomerEntity>>

    @Query("SELECT * FROM customers WHERE clientId = :clientId ORDER BY customerName")
    suspend fun getByClient(clientId: String): List<CustomerEntity>

    @Query("SELECT * FROM customers WHERE clientId = :clientId AND customerType = :type ORDER BY customerName")
    suspend fun getByType(clientId: String, type: String): List<CustomerEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(customers: List<CustomerEntity>)

    @Query("DELETE FROM customers WHERE clientId = :clientId")
    suspend fun deleteByClient(clientId: String)

    @Transaction
    suspend fun replaceForClient(clientId: String, customers: List<CustomerEntity>) {
        deleteByClient(clientId)
        upsertAll(customers)
    }
}

@Dao
interface InventoryDao {
    @Query("SELECT * FROM inventory WHERE clientId = :clientId ORDER BY productType, size")
    fun observeByClient(clientId: String): Flow<List<InventoryEntity>>

    @Query("SELECT * FROM inventory WHERE clientId = :clientId ORDER BY productType, size")
    suspend fun getByClient(clientId: String): List<InventoryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<InventoryEntity>)

    @Query("DELETE FROM inventory WHERE clientId = :clientId")
    suspend fun deleteByClient(clientId: String)

    @Transaction
    suspend fun replaceForClient(clientId: String, items: List<InventoryEntity>) {
        deleteByClient(clientId)
        upsertAll(items)
    }
}

@Dao
interface DashboardCacheDao {
    @Query("SELECT * FROM dashboard_cache WHERE clientId = :clientId")
    suspend fun get(clientId: String): DashboardCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(cache: DashboardCacheEntity)
}

@Dao
interface PendingEntryDao {
    @Query("SELECT * FROM pending_entries WHERE synced = 0 ORDER BY createdAt ASC")
    suspend fun getUnsynced(): List<PendingEntryEntity>

    @Insert
    suspend fun insert(entry: PendingEntryEntity): Long

    @Query("UPDATE pending_entries SET synced = 1 WHERE localId = :localId")
    suspend fun markSynced(localId: Long)

    @Query("DELETE FROM pending_entries WHERE synced = 1")
    suspend fun clearSynced()
}
