#import bevy_sprite_render::mesh2d_vertex_output::VertexOutput

struct PulseMaterial {
    color: vec4<f32>,
};

@group(2) @binding(0) var<uniform> material: PulseMaterial;
@group(2) @binding(1) var texture: texture_2d<f32>;
@group(2) @binding(2) var texture_sampler: sampler;

@fragment
fn fragment(
    mesh: VertexOutput,
) -> @location(0) vec4<f32> {
    let tex_color = textureSample(texture, texture_sampler, mesh.uv);
    return material.color * tex_color;
}
