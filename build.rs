fn main() -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path().unwrap());
    }

    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    tonic_prost_build::configure()
        .file_descriptor_set_path(out_dir.join("livemap_descriptor.bin"))
        .compile_protos(
            &[
                "proto/livemap/v1/livemap.proto",
                "proto/summary/v1/summary.proto",
            ],
            &["proto"],
        )?;

    Ok(())
}
