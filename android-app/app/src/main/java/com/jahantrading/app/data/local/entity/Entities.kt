package com.jahantrading.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "products")
data class ProductEntity(
    @PrimaryKey val id: Int,
    val clientId: String,
    val productType: String,
    val size: String,
    val unitPrice: Double
)

@Entity(tableName = "customers")
data class CustomerEntity(
    @PrimaryKey val id: Int,
    val clientId: String,
    val customerName: String,
    val customerType: String,
    val contactNumber: String?
)

@Entity(tableName = "inventory")
data class InventoryEntity(
    @PrimaryKey val id: Int,
    val clientId: String,
    val productType: String,
    val size: String,
    val quantity: Double,
    val costPrice: Double
)

@Entity(tableName = "dashboard_cache")
data class DashboardCacheEntity(
    @PrimaryKey val clientId: String,
    val jsonData: String,
    val cachedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "pending_entries")
data class PendingEntryEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val entryId: String,
    val clientId: String,
    val jsonPayload: String,
    val createdAt: Long = System.currentTimeMillis(),
    val synced: Boolean = false
)
