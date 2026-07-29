#!/usr/bin/env python3
"""
Config Generator for Jahan Trading System Resale
Customizes config.json for each customer with their branding and cloud database details.

Usage:
    python generate_customer_config.py

This is a white-labeling tool to generate one config.json per customer.
Each customer gets their own database connection details and company branding.
"""

import json
import os
import sys
from pathlib import Path

from secure_config import encrypt_dict


def prompt(label, default=None, required=True):
    """Prompt user for input with optional default."""
    if default:
        msg = f"{label} [{default}]: "
    else:
        msg = f"{label}: "

    value = input(msg).strip()

    if not value:
        if default:
            return default
        if required:
            print(f"  [X] This field is required. Please try again.")
            return prompt(label, default, required)
        return None
    return value


def main():
    print("=" * 70)
    print("  JAHAN TRADING SYSTEM - CUSTOMER CONFIG GENERATOR")
    print("=" * 70)
    print()
    print("This tool generates a customized config.json for one customer.")
    print("Each customer needs their own MySQL database (Aiven, DigitalOcean, etc.)")
    print()

    # Company & Branding Info
    print("\n--- CUSTOMER COMPANY DETAILS ---")
    company_name = prompt("Company / Firm Name")
    sub_heading = prompt("Business Tagline / Sub-Heading", default="Importers, Exporters & Wholesale Distributors", required=False)
    address = prompt("Official Address")
    phone = prompt("Phone Number(s)")
    email = prompt("Official Email")
    website = prompt("Website", default="www.jahantrading.com", required=False)

    # Database Connection
    print("\n--- MYSQL DATABASE CONNECTION DETAILS ---")
    print("These should come from your cloud provider (Aiven, DigitalOcean, etc.)")
    print()

    db_host = prompt("Database Host / Server Address\n  (e.g., mysql-xxxxx.aivencloud.com or mysql-yyy.db.ondigitalocean.com)")
    db_port = prompt("Database Port", default="3306", required=False)
    db_user = prompt("Database Username\n  (e.g., avnadmin for Aiven, doadmin for DigitalOcean)")
    db_password = prompt("Database Password\n  (will be stored in config.json — keep this file secure!)")
    db_name = prompt("Database Name\n  (e.g., defaultdb for Aiven, your_db_name for DigitalOcean)")
    ssl_ca_path = prompt(
        "Path to SSL CA certificate file (ca.pem)\n"
        "  Download from the provider's dashboard (Aiven: Service > Overview > CA Certificate).\n"
        "  Leave blank to connect with encryption but no certificate verification",
        default="",
        required=False
    )

    # Optional: other settings
    print("\n--- OPTIONAL SETTINGS ---")
    footer_note = prompt(
        "Invoice Footer Note",
        default="Goods once sold cannot be returned without original invoice. Thank you for your business!",
        required=False
    )
    app_name = prompt(
        "Application Display Name",
        default="JAHAN TRADING SYSTEM",
        required=False
    )

    # Load template config
    template_path = Path(__file__).parent / "config.json"
    if not template_path.exists():
        print(f"\n[X] Error: Template config.json not found at {template_path}")
        sys.exit(1)

    with open(template_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    # Customize the config
    config['system']['app_name'] = app_name
    config['system']['currency_symbol'] = 'BDT'  # Keep as is

    # The host/user/password/database are encrypted at rest so the shipped
    # config.json never has the raw DB password in plain text. The app
    # decrypts this automatically at startup using a fixed passphrase — the
    # customer never sees or enters anything.
    sensitive_db_fields = {
        'host': db_host,
        'port': int(db_port),
        'user': db_user,
        'password': db_password,
        'database': db_name,
        'ssl_required': True,
        'ssl_ca_path': ssl_ca_path or "",
    }
    config['database_config'] = {
        'mode': 'mysql',
        'encrypted': encrypt_dict(sensitive_db_fields),
    }

    config['letterhead']['company_name'] = company_name
    config['letterhead']['sub_heading'] = sub_heading
    config['letterhead']['address'] = address
    config['letterhead']['phone'] = phone
    config['letterhead']['email'] = email
    config['letterhead']['website'] = website
    config['letterhead']['footer_note'] = footer_note

    # Save to output
    output_filename = f"config_{company_name.replace(' ', '_')}.json"
    output_path = Path(__file__).parent / output_filename

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print()
    print("=" * 70)
    print("  [OK] CONFIG GENERATED SUCCESSFULLY")
    print("=" * 70)
    print()
    print(f"Output file: {output_filename}")
    print(f"Full path: {output_path}")
    print()
    print("NEXT STEPS:")
    print("  1. Replace the dist/JahanTradingSystem/_internal/config.json")
    print("     with this file (or rename it to config.json)")
    print()
    print("  2. Give the customer the entire dist/JahanTradingSystem/ folder")
    print("     (they can delete config_*.json files to clean up)")
    print()
    print("  3. Customer runs: dist/JahanTradingSystem/JahanTradingSystem.exe")
    print()
    print("  4. On first run, the app creates the database schema automatically")
    print("     and seeds demo data (1 admin user: admin / admin123)")
    print()
    print("IMPORTANT SECURITY REMINDERS:")
    print("  • The database password is encrypted at rest in this config.json")
    print("    (decrypted automatically by the app at startup — nothing to")
    print("    hand the customer or type in). Still avoid distributing it")
    print("    unnecessarily since the encryption key is fixed in the source.")
    print("  • Before shipping, verify the database connection works by running")
    print("    the exe once in a test environment")
    print("  • Instruct customers to change the admin password (admin123) immediately")
    print("  • Use HTTPS/VPN if the database is accessed over the internet")
    print()


if __name__ == '__main__':
    main()
