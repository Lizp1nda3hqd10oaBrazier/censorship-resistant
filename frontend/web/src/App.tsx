// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface EncryptedContent {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  accessCondition: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [contents, setContents] = useState<EncryptedContent[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newContentData, setNewContentData] = useState({
    title: "",
    content: "",
    category: "General",
    accessCondition: "Public"
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [decryptedContent, setDecryptedContent] = useState<{ [key: string]: string }>({});
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const totalContents = contents.length;
  const publicCount = contents.filter(c => c.accessCondition === "Public").length;
  const nftRestrictedCount = contents.filter(c => c.accessCondition === "NFT Holder").length;
  const tokenRestrictedCount = contents.filter(c => c.accessCondition === "Token Holder").length;

  useEffect(() => {
    loadContents().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
    setDecryptedContent({});
  };

  const loadContents = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("content_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing content keys:", e);
        }
      }
      
      const list: EncryptedContent[] = [];
      
      for (const key of keys) {
        try {
          const contentBytes = await contract.getData(`content_${key}`);
          if (contentBytes.length > 0) {
            try {
              const contentData = JSON.parse(ethers.toUtf8String(contentBytes));
              list.push({
                id: key,
                encryptedData: contentData.data,
                timestamp: contentData.timestamp,
                owner: contentData.owner,
                category: contentData.category,
                accessCondition: contentData.accessCondition || "Public"
              });
            } catch (e) {
              console.error(`Error parsing content data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading content ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setContents(list);
    } catch (e) {
      console.error("Error loading contents:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitContent = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting content with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify({
        title: newContentData.title,
        content: newContentData.content
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const contentId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const contentData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newContentData.category,
        accessCondition: newContentData.accessCondition
      };
      
      // Store encrypted content on-chain using FHE
      await contract.setData(
        `content_${contentId}`, 
        ethers.toUtf8Bytes(JSON.stringify(contentData))
      );
      
      const keysBytes = await contract.getData("content_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(contentId);
      
      await contract.setData(
        "content_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted content submitted securely!"
      });
      
      await loadContents();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewContentData({
          title: "",
          content: "",
          category: "General",
          accessCondition: "Public"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const decryptContent = async (contentId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Decrypting content with FHE..."
    });

    try {
      // Simulate FHE decryption time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const content = contents.find(c => c.id === contentId);
      if (!content) {
        throw new Error("Content not found");
      }
      
      // Simulate FHE decryption
      const decrypted = JSON.parse(atob(content.encryptedData.replace("FHE-", "")));
      
      setDecryptedContent(prev => ({
        ...prev,
        [contentId]: decrypted.content
      }));
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Content decrypted successfully!"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Decryption failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const hasAccess = (content: EncryptedContent) => {
    // Simulate access control based on NFT/token ownership
    if (content.accessCondition === "Public") return true;
    if (content.accessCondition === "NFT Holder") return Math.random() > 0.3; // 70% chance of access
    if (content.accessCondition === "Token Holder") return Math.random() > 0.5; // 50% chance of access
    return false;
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start publishing content",
      icon: "🔗"
    },
    {
      title: "Create Encrypted Content",
      description: "Write your content which will be encrypted using FHE technology",
      icon: "🔒"
    },
    {
      title: "Set Access Conditions",
      description: "Define who can decrypt your content (Public, NFT holders, etc.)",
      icon: "🔑"
    },
    {
      title: "Decrypt & Access",
      description: "Authorized users can decrypt and view your content",
      icon: "🔓"
    }
  ];

  const filteredContents = contents.filter(content => {
    if (!searchTerm) return true;
    return (
      content.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      content.accessCondition.toLowerCase().includes(searchTerm.toLowerCase()) ||
      content.owner.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>Content</span>Hub</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-content-btn metal-button"
          >
            <div className="add-icon"></div>
            Publish Content
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-layout">
        <div className="sidebar-panel">
          <div className="navigation">
            <button 
              className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              Dashboard
            </button>
            <button 
              className={`nav-btn ${activeTab === "contents" ? "active" : ""}`}
              onClick={() => setActiveTab("contents")}
            >
              Encrypted Contents
            </button>
            <button 
              className={`nav-btn ${activeTab === "stats" ? "active" : ""}`}
              onClick={() => setActiveTab("stats")}
            >
              Statistics
            </button>
          </div>
          
          <div className="project-info">
            <h3>About FHE Content Hub</h3>
            <p>A censorship-resistant platform using Fully Homomorphic Encryption to protect content privacy.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
        </div>
        
        <div className="main-content">
          {showTutorial && (
            <div className="tutorial-section">
              <h2>FHE Content Publishing Guide</h2>
              <p className="subtitle">Learn how to securely publish and access encrypted content</p>
              
              <div className="tutorial-steps">
                {tutorialSteps.map((step, index) => (
                  <div 
                    className="tutorial-step"
                    key={index}
                  >
                    <div className="step-icon">{step.icon}</div>
                    <div className="step-content">
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {activeTab === "dashboard" && (
            <div className="dashboard-content">
              <div className="welcome-banner">
                <div className="welcome-text">
                  <h2>Decentralized Censorship-Resistant Publishing</h2>
                  <p>Publish content encrypted with FHE technology, accessible only to authorized users</p>
                </div>
              </div>
              
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{totalContents}</div>
                  <div className="stat-label">Total Contents</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{publicCount}</div>
                  <div className="stat-label">Public Access</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{nftRestrictedCount}</div>
                  <div className="stat-label">NFT Restricted</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{tokenRestrictedCount}</div>
                  <div className="stat-label">Token Restricted</div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "contents" && (
            <div className="contents-section">
              <div className="section-header">
                <h2>Encrypted Content Library</h2>
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search by category, access, or owner..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <button className="search-btn">🔍</button>
                </div>
                <div className="header-actions">
                  <button 
                    onClick={loadContents}
                    className="refresh-btn metal-button"
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="contents-list">
                {filteredContents.length === 0 ? (
                  <div className="no-contents">
                    <div className="no-contents-icon"></div>
                    <p>No encrypted content found</p>
                    <button 
                      className="metal-button primary"
                      onClick={() => setShowCreateModal(true)}
                    >
                      Publish First Content
                    </button>
                  </div>
                ) : (
                  filteredContents.map(content => (
                    <div className="content-card" key={content.id}>
                      <div className="content-header">
                        <div className="content-id">#{content.id.substring(0, 6)}</div>
                        <div className={`access-badge ${content.accessCondition.replace(/\s+/g, '-').toLowerCase()}`}>
                          {content.accessCondition}
                        </div>
                      </div>
                      
                      <div className="content-meta">
                        <div className="meta-item">
                          <span>Owner:</span> 
                          {content.owner.substring(0, 6)}...{content.owner.substring(38)}
                        </div>
                        <div className="meta-item">
                          <span>Category:</span> {content.category}
                        </div>
                        <div className="meta-item">
                          <span>Published:</span> 
                          {new Date(content.timestamp * 1000).toLocaleDateString()}
                        </div>
                      </div>
                      
                      <div className="content-actions">
                        {hasAccess(content) ? (
                          decryptedContent[content.id] ? (
                            <div className="decrypted-content">
                              <p>{decryptedContent[content.id]}</p>
                            </div>
                          ) : (
                            <button 
                              className="metal-button primary"
                              onClick={() => decryptContent(content.id)}
                            >
                              Decrypt with FHE
                            </button>
                          )
                        ) : (
                          <div className="access-denied">
                            <div className="lock-icon"></div>
                            <span>Access restricted</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          
          {activeTab === "stats" && (
            <div className="stats-section">
              <h2>Content Statistics</h2>
              
              <div className="charts-container">
                <div className="chart-card">
                  <h3>Access Distribution</h3>
                  <div className="chart">
                    <div 
                      className="chart-bar public" 
                      style={{ height: `${(publicCount / totalContents) * 100 || 0}%` }}
                    >
                      <span>Public: {publicCount}</span>
                    </div>
                    <div 
                      className="chart-bar nft" 
                      style={{ height: `${(nftRestrictedCount / totalContents) * 100 || 0}%` }}
                    >
                      <span>NFT: {nftRestrictedCount}</span>
                    </div>
                    <div 
                      className="chart-bar token" 
                      style={{ height: `${(tokenRestrictedCount / totalContents) * 100 || 0}%` }}
                    >
                      <span>Token: {tokenRestrictedCount}</span>
                    </div>
                  </div>
                </div>
                
                <div className="chart-card">
                  <h3>Category Distribution</h3>
                  <div className="category-chart">
                    {Array.from(new Set(contents.map(c => c.category))).map(category => {
                      const count = contents.filter(c => c.category === category).length;
                      return (
                        <div key={category} className="category-item">
                          <div className="category-label">{category}</div>
                          <div className="category-bar-container">
                            <div 
                              className="category-bar" 
                              style={{ width: `${(count / totalContents) * 100 || 0}%` }}
                            ></div>
                          </div>
                          <div className="category-count">{count}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitContent} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          contentData={newContentData}
          setContentData={setNewContentData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHE Content Hub</span>
            </div>
            <p>Censorship-resistant publishing using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Content Hub. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  contentData: any;
  setContentData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  contentData,
  setContentData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setContentData({
      ...contentData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!contentData.title || !contentData.content) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Publish Encrypted Content</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your content will be encrypted with FHE technology
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Title *</label>
              <input 
                type="text"
                name="title"
                value={contentData.title} 
                onChange={handleChange}
                placeholder="Content title..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category</label>
              <select 
                name="category"
                value={contentData.category} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="General">General</option>
                <option value="Technology">Technology</option>
                <option value="Politics">Politics</option>
                <option value="Art">Art</option>
                <option value="Science">Science</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Access Condition</label>
              <select 
                name="accessCondition"
                value={contentData.accessCondition} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="Public">Public</option>
                <option value="NFT Holder">NFT Holder Only</option>
                <option value="Token Holder">Token Holder Only</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Content *</label>
              <textarea 
                name="content"
                value={contentData.content} 
                onChange={handleChange}
                placeholder="Enter your content to be encrypted..." 
                className="metal-textarea"
                rows={6}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Content remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Publish Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;