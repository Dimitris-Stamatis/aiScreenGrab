import argparse
import tensorflow as tf
from tensorflow.python.framework.convert_to_constants import convert_variables_to_constants_v2

def freeze_saved_model(saved_model_dir, output_pb_path):
    # Load the SavedModel and grab the serving signature
    loaded = tf.saved_model.load(saved_model_dir)
    infer = loaded.signatures["serving_default"]

    # Freeze it (variables → constants)
    frozen_func = convert_variables_to_constants_v2(infer)
    frozen_graph = frozen_func.graph.as_graph_def()

    # Write out the frozen GraphDef
    with tf.io.gfile.GFile(output_pb_path, "wb") as f:
        f.write(frozen_graph.SerializeToString())

    print(f"✅ frozen_model.pb written to {output_pb_path}, num nodes = {len(frozen_graph.node)}")

def main():
    parser = argparse.ArgumentParser(description="Freeze a TensorFlow SavedModel to a .pb frozen graph")
    parser.add_argument("saved_model_dir", help="Path to the TensorFlow SavedModel directory")
    parser.add_argument("output_pb_path", nargs='?', default="frozen_model.pb",
                        help="Output path for the frozen .pb file (default: frozen_model.pb)")
    args = parser.parse_args()

    freeze_saved_model(args.saved_model_dir, args.output_pb_path)

if __name__ == "__main__":
    main()


