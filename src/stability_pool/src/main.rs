fn main() {
    // Export Candid interface when running in Candid generation mode
    candid::export_service!();
    std::print!("{}", __export_service());
}