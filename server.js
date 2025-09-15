// Load environment variables
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");   // ✅ QR Code library

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Ensure uploads folder exists ---
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Serve uploaded files (public)
app.use("/uploads", express.static(uploadDir));

// --- MongoDB connection ---
const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const client = new MongoClient(uri);
let applications, tickets;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("mahalakshmiBusDB");
    applications = db.collection("applications");
    tickets = db.collection("tickets"); // ✅ new collection for tickets
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ Failed to connect MongoDB:", err.message);
    process.exit(1);
  }
}
connectDB();

// --- File upload setup ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Function to generate 8-digit unique ID
function generateUniquePassId() {
  const randomNum = Math.floor(10000000 + Math.random() * 90000000);
  return `TSRTC-${randomNum}`;
}

/* ===========================================================
   1️⃣ Save Application (POST)
   =========================================================== */
app.post(
  "/apply",
  upload.fields([{ name: "photo" }, { name: "aadharFile" }]),
  async (req, res) => {
    try {
      if (!applications) {
        return res.status(500).json({ error: "DB not connected yet" });
      }

      const passId = generateUniquePassId();
      const qrDataUrl = await QRCode.toDataURL(passId);

      const phoneNumber = req.body.phone || req.body.whatsapp || req.body.number;

      const doc = {
        passId,                        // ✅ Store Pass ID
        qrCode: qrDataUrl,             // ✅ Store QR Code (Base64 string)
        name: req.body.name,
        fatherName: req.body.fatherName,
        dob: req.body.dob,
        gender: req.body.gender,
        age: {
          years: req.body.ageYears,
          months: req.body.ageMonths,
          days: req.body.ageDays,
        },
        aadhar: req.body.aadhar,
        phone: phoneNumber,
        whatsapp: req.body.whatsapp || phoneNumber,
        number: req.body.number || phoneNumber,
        email: req.body.email,
        // ✅ Save only relative public paths (so frontend can fetch)
        photo: req.files?.photo ? `/uploads/${req.files.photo[0].filename}` : "",
        aadharFile: req.files?.aadharFile ? `/uploads/${req.files.aadharFile[0].filename}` : "",
        address: req.body.address,
        district: req.body.district,
        mandal: req.body.mandal,
        village: req.body.village,
        pincode: req.body.pincode,
        city: req.body.city,
        passType: req.body.passType,
        paymentMode: "FREE SCHEME",
        deliveryMode: "Bus Pass Counter",
        counter: req.body.counter,
        createdAt: new Date(),
      };

      const result = await applications.insertOne(doc);

      res.json({
        success: true,
        message: "✅ Application stored in MongoDB",
        id: result.insertedId,
        passId,
        qrCode: qrDataUrl,
      });
    } catch (err) {
      console.error("❌ Error inserting:", err.message);
      res.status(500).json({ success: false, error: "Failed to save application" });
    }
  }
);

/* ===========================================================
   2️⃣ Verify by Phone Number (GET)
   =========================================================== */
app.get("/verify/:phone", async (req, res) => {
  try {
    if (!applications) {
      return res.status(500).json({ success: false, error: "DB not connected" });
    }

    const phone = req.params.phone;
    const applicant = await applications.findOne({
      $or: [{ phone }, { whatsapp: phone }, { number: phone }]
    });

    if (applicant) {
      res.json({ success: true, id: applicant._id });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error("❌ Verify error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ===========================================================
   3️⃣ Fetch Applicant by Mongo _id (GET)
   =========================================================== */
app.get("/applicant/:id", async (req, res) => {
  try {
    if (!applications) {
      return res.status(500).json({ success: false, error: "DB not connected" });
    }

    const applicant = await applications.findOne({ _id: new ObjectId(req.params.id) });
    if (applicant) {
      res.json({ success: true, applicant });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error("❌ Fetch error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ===========================================================
   4️⃣ Fetch Applicant by Pass ID (QR Scan) (GET)
   =========================================================== */
app.get("/getApplicant/:passId", async (req, res) => {
  try {
    const applicant = await applications.findOne({ passId: req.params.passId });
    if (!applicant) return res.status(404).json({ success: false, msg: "Not found" });
    res.json(applicant);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ===========================================================
   5️⃣ Book Ticket (POST)
   =========================================================== */
app.post("/bookTicket", async (req, res) => {
  try {
    const { applicantId, source, destination, paymentType, amount } = req.body;
    if (!applicantId || !source || !destination || !paymentType) {
      return res.json({ success: false, msg: "Missing fields" });
    }

    const ticketDoc = {
      applicantId: new ObjectId(applicantId),
      source,
      destination,
      paymentType,
      amount: paymentType === "PAID" ? Number(amount) : 0,
      bookedAt: new Date(),
    };

    const result = await tickets.insertOne(ticketDoc);
    res.json({ success: true, ticket: result.ops?.[0] || ticketDoc });
  } catch (err) {
    console.error("❌ Ticket booking error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ===========================================================
   Start Server
   =========================================================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
