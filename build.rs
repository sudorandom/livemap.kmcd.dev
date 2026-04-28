fn main() -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path().unwrap());
    }

    tonic_prost_build::configure()
        .compile_protos(
            &["proto/livemap/v1/livemap.proto", "proto/summary/v1/summary.proto"],
            &["proto"],
        )?;

    Ok(())
}
