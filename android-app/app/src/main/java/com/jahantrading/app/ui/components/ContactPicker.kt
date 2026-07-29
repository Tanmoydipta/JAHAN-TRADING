package com.jahantrading.app.ui.components

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * Returns a launcher: call it to open the device contact picker (requesting
 * READ_CONTACTS at runtime if needed first) and receive back a phone number.
 */
@Composable
fun rememberContactPicker(onPicked: (name: String, phone: String) -> Unit): () -> Unit {
    val context = LocalContext.current
    var launchPickerAfterGrant by remember { mutableStateOf(false) }

    val pickContactLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickContact()
    ) { uri -> uri?.let { resolveContact(context, it, onPicked) } }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && launchPickerAfterGrant) pickContactLauncher.launch(null)
        launchPickerAfterGrant = false
    }

    return {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) {
            pickContactLauncher.launch(null)
        } else {
            launchPickerAfterGrant = true
            permissionLauncher.launch(Manifest.permission.READ_CONTACTS)
        }
    }
}

private fun resolveContact(context: Context, uri: Uri, onPicked: (String, String) -> Unit) {
    context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return

        val idIdx = cursor.getColumnIndex(ContactsContract.Contacts._ID)
        val nameIdx = cursor.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME)
        val hasPhoneIdx = cursor.getColumnIndex(ContactsContract.Contacts.HAS_PHONE_NUMBER)

        val contactId = idIdx.takeIf { it >= 0 }?.let { cursor.getString(it) }
        val name = nameIdx.takeIf { it >= 0 }?.let { cursor.getString(it) } ?: ""
        val hasPhone = hasPhoneIdx >= 0 && cursor.getInt(hasPhoneIdx) > 0

        var phone = ""
        if (hasPhone && contactId != null) {
            context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
                "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?",
                arrayOf(contactId),
                null
            )?.use { phoneCursor ->
                if (phoneCursor.moveToFirst()) {
                    val numIdx = phoneCursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                    if (numIdx >= 0) phone = phoneCursor.getString(numIdx) ?: ""
                }
            }
        }

        onPicked(name, phone.filter { it.isDigit() || it == '+' })
    }
}
