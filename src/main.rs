mod cli;

fn main() {
    if let Err(e) = cli::run() {
        eprintln!("hunt: {e:#}");
        std::process::exit(1);
    }
}
