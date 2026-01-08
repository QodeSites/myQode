-- Non-Investor Users Table
-- This table stores users who login with Google but are not investors
CREATE TABLE IF NOT EXISTS myqode_non_investor_users (
  id SERIAL PRIMARY KEY,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP,
  login_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  -- Additional tracking fields
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20),

  -- Metadata
  referral_source VARCHAR(100),
  notes TEXT,

  -- Indexes
  CONSTRAINT unique_google_id UNIQUE(google_id),
  CONSTRAINT unique_email UNIQUE(email)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_myqode_non_investor_google_id ON myqode_non_investor_users(google_id);
CREATE INDEX IF NOT EXISTS idx_myqode_non_investor_email ON myqode_non_investor_users(email);
CREATE INDEX IF NOT EXISTS idx_myqode_non_investor_created_at ON myqode_non_investor_users(created_at);
CREATE INDEX IF NOT EXISTS idx_myqode_non_investor_is_active ON myqode_non_investor_users(is_active);

-- Contact Form Submissions Table
CREATE TABLE IF NOT EXISTS contact_submissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES myqode_non_investor_users(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  subject VARCHAR(500),
  message TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'new', -- new, in_progress, resolved, spam
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(255),
  notes TEXT
);

-- Create indexes for contact submissions
CREATE INDEX IF NOT EXISTS idx_contact_email ON contact_submissions(email);
CREATE INDEX IF NOT EXISTS idx_contact_status ON contact_submissions(status);
CREATE INDEX IF NOT EXISTS idx_contact_created_at ON contact_submissions(created_at);

-- Page Views Tracking (optional - for analytics)
CREATE TABLE IF NOT EXISTS non_investor_page_views (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES myqode_non_investor_users(id) ON DELETE CASCADE,
  page_path VARCHAR(500) NOT NULL,
  user_agent TEXT,
  ip_address VARCHAR(45),
  viewed_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for page views
CREATE INDEX IF NOT EXISTS idx_pageview_user_id ON non_investor_page_views(user_id);
CREATE INDEX IF NOT EXISTS idx_pageview_path ON non_investor_page_views(page_path);
CREATE INDEX IF NOT EXISTS idx_pageview_date ON non_investor_page_views(viewed_at);

-- Comments for documentation
COMMENT ON TABLE myqode_non_investor_users IS 'Stores non-investor users who login via Google OAuth';
COMMENT ON TABLE contact_submissions IS 'Stores contact form submissions from non-investors';
COMMENT ON TABLE non_investor_page_views IS 'Tracks page views for analytics';
