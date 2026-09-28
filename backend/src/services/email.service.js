require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: process.env.EMAIL_USER,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    refreshToken: process.env.REFRESH_TOKEN,
  },
});

// Verify the connection configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('Error connecting to email server:', error);
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Function to send email
const sendEmail = async (to, subject, text, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"Backend Ledger" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });

    console.log('Message sent: %s', info.messageId);
    console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

async function sendRegistrationEmail(userEmail, name) {
  const subject = `Welcome to Backend Ledger!`;

  const text = `Hello ${name},\n\nThank you for registering at Backend Ledger. We're excited to have you on board!\n\nBest regards,\nThe Backend Ledger Team`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Backend Ledger</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f4f6f9; font-family:'Segoe UI', Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9; padding:40px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
            
            <!-- Header -->
            <tr>
              <td style="background:linear-gradient(135deg,#0f172a,#1e293b); padding:32px 40px; text-align:center;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center">
                      <div style="display:inline-block; background-color:#22d3ee; color:#0f172a; font-weight:700; font-size:20px; width:44px; height:44px; line-height:44px; border-radius:8px; margin-bottom:12px;">₿L</div>
                      <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:600; letter-spacing:0.5px;">Backend Ledger</h1>
                      <p style="margin:4px 0 0; color:#94a3b8; font-size:13px; letter-spacing:1px; text-transform:uppercase;">Secure Financial Infrastructure</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:40px;">
                <h2 style="margin:0 0 16px; color:#0f172a; font-size:20px;">Welcome aboard, ${name} 👋</h2>
                <p style="margin:0 0 16px; color:#475569; font-size:15px; line-height:1.6;">
                  Thank you for registering with <strong>Backend Ledger</strong>. Your account has been created successfully, and you're now ready to start managing your transactions with confidence.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc; border-left:4px solid #22d3ee; border-radius:6px; margin:24px 0;">
                  <tr>
                    <td style="padding:16px 20px;">
                      <p style="margin:0; color:#0f172a; font-size:14px; font-weight:600;">Account Holder</p>
                      <p style="margin:4px 0 0; color:#475569; font-size:14px;">${name}</p>
                      <p style="margin:12px 0 0; color:#0f172a; font-size:14px; font-weight:600;">Registered Email</p>
                      <p style="margin:4px 0 0; color:#475569; font-size:14px;">${userEmail}</p>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 24px; color:#475569; font-size:15px; line-height:1.6;">
                  Every transaction on Backend Ledger is backed by double-entry bookkeeping and ACID-compliant processing, so your data stays accurate and secure — always.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:6px; background-color:#0f172a;">
                      <a href="#" style="display:inline-block; padding:12px 28px; color:#ffffff; font-size:14px; font-weight:600; text-decoration:none; border-radius:6px;">Go to Dashboard</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color:#f8fafc; padding:24px 40px; text-align:center; border-top:1px solid #e2e8f0;">
                <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  This is an automated message from Backend Ledger. Please do not reply to this email.<br>
                  &copy; ${new Date().getFullYear()} Backend Ledger. All rights reserved.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  await sendEmail(userEmail, subject, text, html);
}

async function sendTransactionEmail(userEmail, name, amount, toAccount) {
  const subject = "Transaction Successful!";

  const text = `Hello ${name},

Your transaction of ₹${amount} to account ${toAccount} was successful.

Thank you for banking with Invester Bank of India.

Best regards,
Invester Bank of India`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
      
      <h2 style="color: #2e7d32;">Transaction Successful</h2>

      <p>Hello <strong>${name}</strong>,</p>

      <p>
        Your transaction has been successfully completed.
      </p>

      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Amount:</strong> ₹${amount}</p>
        <p><strong>To Account:</strong> ${toAccount}</p>
        <p><strong>Status:</strong> Successful</p>
      </div>

      <p>
        Thank you for banking with <strong>Invester Bank of India</strong>.
      </p>

      <p>
        Best regards,<br>
        <strong>Invester Bank of India</strong>
      </p>

    </div>
  `;

  await sendEmail(userEmail, subject, text, html);
}

async function sendTransactionFailureEmail(userEmail, name, amount, toAccount) {
  const subject = "Transaction Failed!";

  const text = `Hello ${name},

Unfortunately, your transaction of ₹${amount} to account ${toAccount} has failed.

Please check your account balance and transaction details, and try again later.

If the amount was deducted from your account, please contact Invester Bank of India support.

Best regards,
Invester Bank of India`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">

      <h2 style="color: #d32f2f;">Transaction Failed</h2>

      <p>Hello <strong>${name}</strong>,</p>

      <p>
        Unfortunately, your transaction could not be completed.
      </p>

      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Amount:</strong> ₹${amount}</p>
        <p><strong>To Account:</strong> ${toAccount}</p>
        <p><strong>Status:</strong> Failed</p>
      </div>

      <p>
        Please check your account balance and transaction details, and try again later.
      </p>

      <p>
        If the amount was deducted from your account, please contact
        <strong>Invester Bank of India</strong> support.
      </p>

      <p>
        Best regards,<br>
        <strong>Invester Bank of India</strong>
      </p>

    </div>
  `;

  await sendEmail(userEmail, subject, text, html);
}


module.exports = { sendRegistrationEmail,sendTransactionEmail,sendTransactionFailureEmail };