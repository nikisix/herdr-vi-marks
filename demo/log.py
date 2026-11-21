"""Print a fake build or test log for the demo recording."""
import random
import sys

random.seed(7)
RED, YELLOW, GREEN, DIM, BOLD, RESET = "\033[31m", "\033[33m", "\033[32m", "\033[2m", "\033[1m", "\033[0m"

def build():
    crates = ["serde", "tokio", "hyper", "axum", "tower", "sqlx", "tracing", "uuid", "chrono", "regex"]
    for i in range(60):
        name = random.choice(crates)
        print(f"   {GREEN}Compiling{RESET} {name}-{name[0]}{i} v0.{i % 9}.{i % 7}")
    print(f"   {GREEN}Compiling{RESET} api v0.4.0 (~/src/api)")
    print(f"{RED}{BOLD}error[E0308]{RESET}{BOLD}: mismatched types{RESET}")
    print(f"  {DIM}-->{RESET} src/routes/users.rs:42:18")
    print(f"   {DIM}|{RESET}")
    print(f"{DIM}42 |{RESET}     let id: u64 = req.param(\"id\");")
    print(f"   {DIM}|{RESET}             {RED}---   ^^^^^^^^^^^^^^^^ expected `u64`, found `&str`{RESET}")
    print(f"   {DIM}|{RESET}")
    for i in range(60):
        print(f"{YELLOW}warning{RESET}: unused import `crate::util::helper_{i}`  {DIM}src/lib.rs:{i + 3}{RESET}")
    print(f"{RED}{BOLD}error{RESET}: could not compile `api` due to 1 previous error; 60 warnings emitted")

def tests():
    mods = ["auth", "users", "billing", "search", "events", "cache", "jobs"]
    n = 0
    for mod in mods:
        for i in range(10):
            n += 1
            print(f"tests/test_{mod}.py::test_{mod}_case_{i:02d} {GREEN}PASSED{RESET}  {DIM}[{n:3d}%]{RESET}")
        if mod == "billing":
            print(f"tests/test_billing.py::test_refund_rounding {RED}{BOLD}FAILED{RESET}")
            print(f"{RED}E   assert Decimal('10.01') == Decimal('10.00'){RESET}")
    for i in range(40):
        print(f"tests/test_integration.py::test_flow_{i:02d} {GREEN}PASSED{RESET}")
    print(f"{RED}{BOLD}===== 1 failed, 110 passed in 4.21s ====={RESET}")

{"build": build, "tests": tests}[sys.argv[1]]()
