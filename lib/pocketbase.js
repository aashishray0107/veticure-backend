import axios from "axios";

const PB_URL = "http://127.0.0.1:8090/api";

export async function saveReport(data) {
  try {
    const res = await axios.post(
      `${PB_URL}/collections/reports/records`,
      data
    );

    return res.data;
  } catch (error) {
    console.error("PocketBase error:", error.response?.data || error.message);
    throw error;
  }
}