import { connect } from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://fuse:fuse2024@cluster0.zd44z.mongodb.net/Fusedb?retryWrites=true&w=majority&appName=Cluster0';

const connectDB = async () => {
  try {
    const conn = await connect(MONGO_URI);

    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1); 
  }
};

export default connectDB;