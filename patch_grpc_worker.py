import re

with open("pkg/bgpengine/grpc_worker.go", "r") as f:
    content = f.read()

if "consumeAlertStream" not in content:
    # Add consumeAlertStream to runGRPCClient
    content = content.replace(
        "// 3. Start Event Stream\n\treturn e.consumeEventStream(ctx, client)",
        "// 3. Start Alert Stream\n\tgo e.consumeAlertStream(ctx, client)\n\n\t// 4. Start Event Stream\n\treturn e.consumeEventStream(ctx, client)"
    )

    # Add the consumeAlertStream function
    func_code = """
func (e *Engine) consumeAlertStream(ctx context.Context, client livemap.LiveMapServiceClient) error {
	stream, err := client.StreamAlerts(ctx, &livemap.StreamAlertsRequest{})
	if err != nil {
		return err
	}

	log.Println("[GRPC] Subscribed to alert stream")
	for {
		resp, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		if alert := resp.GetAlert(); alert != nil {
			e.RecordAlert(alert)
		}
	}
}
"""
    content += func_code

    with open("pkg/bgpengine/grpc_worker.go", "w") as f:
        f.write(content)
    print("Patched grpc_worker.go successfully")
else:
    print("Already patched grpc_worker.go")
