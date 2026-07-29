import subprocess
import sys
import os

def build_exe():
    print("==================================================")
    print("  BUILDING FAST-STARTUP JAHAN TRADING SYSTEM (DIR)")
    print("==================================================")

    base_dir = os.path.dirname(os.path.abspath(__file__))
    static_dir = os.path.join(base_dir, "static")
    config_file = os.path.join(base_dir, "config.json")
    ca_cert_file = os.path.join(base_dir, "ca.pem")
    app_file = os.path.join(base_dir, "app.py")

    sep = ";" if os.name == "nt" else ":"

    # Build with the same interpreter running this script (guarantees Flask/PyMySQL
    # are the ones actually installed, instead of whatever "pyinstaller" resolves to on PATH)
    python_exe = sys.executable

    # Use --onedir mode for instant 1-second startup (no temp file extraction delay)
    cmd = [
        python_exe, "-m", "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--name", "JahanTradingSystem",
        f"--add-data={static_dir}{sep}static",
        f"--add-data={config_file}{sep}.",
    ]

    if os.path.exists(ca_cert_file):
        cmd.append(f"--add-data={ca_cert_file}{sep}.")
    else:
        print(f"NOTE: {ca_cert_file} not found — skipping (only needed for cloud MySQL SSL).")

    cmd += [
        "--exclude-module=tkinter",
        "--exclude-module=matplotlib",
        "--exclude-module=unittest",
        "--exclude-module=pydoc",
        "--hidden-import=flask",
        "--hidden-import=pymysql",
        "--hidden-import=sqlite3",
        "--hidden-import=winotify",
        app_file
    ]

    print("Running Command:", " ".join(cmd))
    result = subprocess.run(cmd, cwd=base_dir)
    
    if result.returncode == 0:
        exe_path = os.path.join(base_dir, "dist", "JahanTradingSystem", "JahanTradingSystem.exe")
        print("\nBUILD SUCCESSFUL!")
        print(f"Fast-Startup Executable created at: {exe_path}")
    else:
        print("\nBUILD FAILED with error code:", result.returncode)

if __name__ == "__main__":
    build_exe()
