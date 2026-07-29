package com.jahantrading.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.jahantrading.app.data.local.dao.*
import com.jahantrading.app.data.local.entity.*

@Database(
    entities = [
        ProductEntity::class,
        CustomerEntity::class,
        InventoryEntity::class,
        DashboardCacheEntity::class,
        PendingEntryEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun customerDao(): CustomerDao
    abstract fun inventoryDao(): InventoryDao
    abstract fun dashboardCacheDao(): DashboardCacheDao
    abstract fun pendingEntryDao(): PendingEntryDao
}
