import dotenv from 'dotenv';
import twilio from 'twilio';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

const client = twilio(accountSid, authToken);

// Send OTP using Twilio Verify API
export const sendOTP = async (phoneNumber) => {
  try {
    const formattedPhoneNumber = phoneNumber.replace(/\++/, '+');
    console.log('Sending OTP to:', formattedPhoneNumber);

    const result = await client.verify.v2.services(verifyServiceSid) // Use v2.services as v1 is deprecated
      .verifications
      .create({ to: formattedPhoneNumber, channel: 'sms' });

    console.log('OTP sent:', result.status);
    return result;
  } catch (error) {
    console.error('Error sending OTP:', error);
    throw new Error(`Failed to send OTP: ${error.message}`);
  }
};

// Verify OTP using Twilio Verify API
export const verifyOTP = async (phoneNumber, code) => {
  try {
    // Trim spaces and fix double country code issue
    let formattedPhoneNumber = phoneNumber.trim();
    formattedPhoneNumber = formattedPhoneNumber.replace(/^(\+91)(\+91)?/, '+91'); // Fix duplicate +91 issue
    formattedPhoneNumber = formattedPhoneNumber.replace(/\s+/g, ''); // Remove spaces

    console.log(`✅ Verifying OTP for: ${formattedPhoneNumber}, Code: ${code}`);

    const result = await client.verify.v2.services(verifyServiceSid)
      .verificationChecks
      .create({ to: formattedPhoneNumber, code });

    console.log('✅ OTP verification result:', result);

    return result.status === 'approved';
  } catch (error) {
    console.error('❌ Error verifying OTP:', error);
    throw new Error(`Failed to verify OTP: ${error.message}`);
  }
};

  

export default { sendOTP, verifyOTP };
